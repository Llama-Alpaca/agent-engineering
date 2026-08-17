/**
 * Lesson 03 - a deterministic Agent turn/step loop.
 *
 * The real implementation is packages/core/agent/src/inbox.ts,
 * packages/core/agent-loop/src/agent.ts and docs/agent-lifecycle.md.  This
 * course-owned model keeps the durable Session vocabulary and live event
 * boundaries, but replaces the provider, tools and wall-clock scheduling with
 * a scripted implementation.
 */

import {
  assert,
  expectThrows,
  printResult,
  type TraceEvent,
} from "../common/trace.ts"

export type InboxTarget = "next-turn" | "next-step"
export type CancelPoint = "pre-step" | "stream" | "tool"
export type CancelCause = CancelPoint | "disposed"

export interface UserMessage {
  id: string
  content: string
  source: "user" | "followup" | "steer" | "inject" | "tool"
}

export type ScriptedResponse =
  | { kind: "text"; chunks: string[] }
  | { kind: "tool"; chunks: string[]; callId: string; name: string; arguments: string }

export interface LoopHook {
  (point: "pre-step" | "stream" | "tool", agent: Agent, turn: number, step: number): void
}

function event(stream: "durable" | "live", type: string, data: Record<string, string | number | boolean>): TraceEvent {
  return { type, data: { stream, ...data } }
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    const reason = typeof signal.reason === "string" ? signal.reason : "aborted"
    const error = new Error(`agent aborted: ${reason}`)
    error.name = "AbortError"
    throw error
  }
}

/** A scripted async stream; no network and no model key are involved. */
export class ScriptedLLM {
  private readonly responses: ScriptedResponse[]
  private cursor = 0

  constructor(responses: readonly ScriptedResponse[]) {
    this.responses = responses.map(response => structuredClone(response))
  }

  async *stream(signal: AbortSignal): AsyncGenerator<{ kind: "text" | "tool"; text?: string; callId?: string; name?: string; arguments?: string }> {
    const response = this.responses[this.cursor++]
    if (response === undefined) throw new Error("scripted LLM exhausted")
    for (const chunk of response.chunks) {
      throwIfAborted(signal)
      await Promise.resolve()
      yield { kind: "text", text: chunk }
    }
    if (response.kind === "tool") {
      throwIfAborted(signal)
      yield { kind: "tool", callId: response.callId, name: response.name, arguments: response.arguments }
    }
  }
}

/** Durable projection of the two pending Inbox lists. */
export class Inbox {
  readonly nextTurn: UserMessage[] = []
  readonly nextStep: UserMessage[] = []

  private readonly record: (
    stream: "durable" | "live",
    type: string,
    data: Record<string, string | number | boolean>,
  ) => void

  constructor(record: (
    stream: "durable" | "live",
    type: string,
    data: Record<string, string | number | boolean>,
  ) => void) {
    this.record = record
  }

  get hasPending(): boolean {
    return this.nextTurn.length > 0 || this.nextStep.length > 0
  }

  append(target: InboxTarget, message: UserMessage): void {
    if ([...this.nextTurn, ...this.nextStep].some(item => item.id === message.id)) {
      throw new Error(`message ${message.id} is already pending`)
    }
    this[target === "next-turn" ? "nextTurn" : "nextStep"].push(message)
    this.record("durable", "agent/inbox/spliced", { target, operation: "insert", id: message.id })
    this.record("live", "agent/inbox/inserted", { target, id: message.id })
  }

  claim(target: InboxTarget, turn: number): UserMessage[] {
    const claimed = this.nextStep.splice(0)
    if (target === "next-turn") {
      const first = this.nextTurn.shift()
      if (first !== undefined) claimed.push(first)
    }
    this.record("durable", "agent/inbox/spliced", { target, operation: "claim", count: claimed.length })
    for (const message of claimed) this.record("live", "agent/inbox/claimed", { id: message.id, turn })
    return claimed
  }

  clear(): void {
    const removed = [
      ...this.nextStep.map(message => ({ target: "next-step" as const, message })),
      ...this.nextTurn.map(message => ({ target: "next-turn" as const, message })),
    ]
    this.nextStep.length = 0
    this.nextTurn.length = 0
    for (const { target, message } of removed) {
      this.record("durable", "agent/inbox/spliced", { target, operation: "cancel", id: message.id })
      this.record("live", "agent/inbox/discarded", { id: message.id })
    }
  }
}

export class Agent {
  readonly id: string
  readonly inbox: Inbox
  readonly trace: TraceEvent[] = []
  readonly durable: TraceEvent[] = []
  readonly live: TraceEvent[] = []
  private readonly llm: ScriptedLLM
  private hook: LoopHook | undefined
  private phase: "idle" | "running" | "disposed" = "idle"
  private driver: Promise<void> | undefined
  private abortController: AbortController | undefined
  private disposeRequested = false
  private turnNumber = 0
  private stepNumber = 0
  private requestHeaderLogged = false

  constructor(id: string, llm: ScriptedLLM) {
    this.id = id
    this.llm = llm
    this.inbox = new Inbox((stream, type, data) => this.record(stream, type, data))
  }

  get status(): "idle" | "running" {
    return this.phase === "running" ? "running" : "idle"
  }

  get disposed(): boolean {
    return this.phase === "disposed"
  }

  setHook(hook: LoopHook | undefined): void {
    this.hook = hook
  }

  followup(message: UserMessage): void {
    this.send({ ...message, source: "followup" }, "next-turn", true)
  }

  steer(message: UserMessage): void {
    this.send({ ...message, source: "steer" }, "next-step", true)
  }

  inject(message: UserMessage): void {
    this.send({ ...message, source: "inject" }, "next-step", false)
  }

  send(message: UserMessage, target: InboxTarget, wakeup: boolean): void {
    if (this.disposed || this.disposeRequested) throw new Error(`agent ${this.id} is disposed`)
    this.inbox.append(target, message)
    if (wakeup) {
      if (this.phase === "idle") this.startDriver()
    }
  }

  cancel(point: CancelCause, keepInbox = false): void {
    if (this.phase !== "running") return
    if (!keepInbox) this.inbox.clear()
    this.abortController?.abort(point)
  }

  async whenIdle(): Promise<void> {
    if (this.driver !== undefined) await this.driver
  }

  async dispose(): Promise<void> {
    if (this.phase === "disposed") return
    this.disposeRequested = true
    if (this.phase === "running") this.cancel("disposed")
    else this.inbox.clear()
    await this.whenIdle()
    this.phase = "disposed"
    this.record("live", "agent/disposed", { id: this.id })
  }

  private record(stream: "durable" | "live", type: string, data: Record<string, string | number | boolean>): void {
    const item = event(stream, type, data)
    this.trace.push(item)
    ;(stream === "durable" ? this.durable : this.live).push(item)
  }

  private startDriver(): void {
    if (this.phase !== "idle" || this.disposeRequested) return
    this.phase = "running"
    this.record("live", "agent/status", { status: "running" })
    this.driver = this.drive().finally(() => {
      this.driver = undefined
    })
  }

  private async drive(): Promise<void> {
    try {
      while (this.inbox.hasPending && !this.disposeRequested) {
        await this.turn()
        if (!this.inbox.hasPending) break
      }
    } finally {
      this.abortController = undefined
      if (this.phase !== "disposed") {
        this.phase = "idle"
        this.record("live", "agent/status", { status: "idle" })
      }
    }
  }

  private async turn(): Promise<void> {
    const turn = ++this.turnNumber
    this.stepNumber = 0
    this.record("durable", "turn/start", { turn })
    let reason = "completed"
    let target: InboxTarget = "next-turn"
    this.abortController = new AbortController()
    const signal = this.abortController.signal
    try {
      while (true) {
        throwIfAborted(signal)
        const step = this.stepNumber + 1
        const messages = this.inbox.claim(target, turn)
        this.record("live", "agent/pre-step", { turn, step, messages: messages.length })
        this.hook?.("pre-step", this, turn, step)
        throwIfAborted(signal)
        if (messages.length === 0) break
        this.record("durable", "step/start", { turn, step })
        this.stepNumber = step
        for (const message of messages) {
          this.record("durable", "user/message", { turn, step, id: message.id, source: message.source })
        }
        try {
          await this.step(turn, step, signal)
        } finally {
          // Mirrors the upstream `finally` around every entered step.
          this.record("durable", "step/end", { turn, step })
        }
        throwIfAborted(signal)
        if (this.inbox.nextStep.length === 0) {
          this.record("live", "agent/turn-stopping", { turn })
          break
        }
        target = "next-step"
      }
    } catch (error) {
      if (signal.aborted || (error instanceof Error && error.name === "AbortError")) {
        reason = `aborted:${String(signal.reason ?? "unknown")}`
      } else {
        reason = `error:${error instanceof Error ? error.message : String(error)}`
        this.record("live", "agent/error", { turn, step: this.stepNumber, message: reason })
      }
    } finally {
      // A turn boundary is balanced even when pre-step, stream, or tool work aborts.
      this.record("durable", "turn/end", { turn, reason })
    }
  }

  private async step(turn: number, step: number, signal: AbortSignal): Promise<void> {
    throwIfAborted(signal)
    if (!this.requestHeaderLogged) {
      this.record("durable", "request/header", { reason: "initial", provider: "scripted", model: "offline" })
      this.requestHeaderLogged = true
    }
    this.record("live", "agent/request", { turn, step })
    let toolCall: { callId: string; name: string; arguments: string } | undefined
    for await (const chunk of this.llm.stream(signal)) {
      if (chunk.kind === "text") {
        this.record("durable", "assistant/chunk", { turn, step, text: chunk.text ?? "" })
      } else {
        toolCall = { callId: chunk.callId ?? "", name: chunk.name ?? "", arguments: chunk.arguments ?? "" }
      }
      this.hook?.("stream", this, turn, step)
      throwIfAborted(signal)
    }
    if (toolCall === undefined) {
      this.record("durable", "assistant/message", { turn, step, content: "text" })
      return
    }
    this.record("durable", "assistant/message", { turn, step, content: `tool:${toolCall.name}` })
    this.record("durable", "tool/call", { turn, step, callId: toolCall.callId, name: toolCall.name })
    this.record("live", "tools/pre-execute", { turn, step, callId: toolCall.callId })
    this.hook?.("tool", this, turn, step)
    if (signal.aborted) {
      this.record("durable", "tool/result", { turn, step, callId: toolCall.callId, result: "aborted-before-dispatch" })
      throwIfAborted(signal)
    }
    this.record("live", "tools/execute", { turn, step, callId: toolCall.callId })
    await Promise.resolve()
    throwIfAborted(signal)
    this.record("live", "tools/post-execute", { turn, step, callId: toolCall.callId })
    this.record("durable", "tool/result", { turn, step, callId: toolCall.callId, result: "ok" })
    this.inbox.append("next-step", { id: `tool-context-${turn}-${step}`, content: "tool result", source: "tool" })
  }
}

export function assertBalancedAgent(agent: Agent): void {
  const turns = new Set<number>()
  const steps = new Set<string>()
  const calls = new Set<string>()
  for (const item of agent.durable) {
    const turn = Number(item.data.turn)
    if (item.type === "turn/start") turns.add(turn)
    if (item.type === "turn/end") {
      assert(turns.has(turn), `turn ${turn} ended before start`)
      turns.delete(turn)
    }
    if (item.type === "step/start") steps.add(`${turn}/${item.data.step}`)
    if (item.type === "step/end") {
      const key = `${turn}/${item.data.step}`
      assert(steps.has(key), `step ${key} ended before start`)
      steps.delete(key)
    }
    if (item.type === "tool/call") calls.add(String(item.data.callId))
    if (item.type === "tool/result") {
      const id = String(item.data.callId)
      assert(calls.has(id), `tool result ${id} has no call`)
      calls.delete(id)
    }
  }
  assert(turns.size === 0, "agent has an open turn")
  assert(steps.size === 0, "agent has an open step")
  assert(calls.size === 0, "agent has an unpaired tool call")
}

function tagTrace(scenario: string, events: readonly TraceEvent[]): TraceEvent[] {
  return events.map(item => {
    const data = item.data !== null && typeof item.data === "object" && !Array.isArray(item.data)
      ? item.data
      : {}
    return { type: item.type, data: { scenario, ...data } }
  })
}

export async function runCancellation(point: CancelPoint): Promise<Agent> {
  const response: ScriptedResponse = point === "tool"
    ? { kind: "tool", chunks: ["planning"], callId: `cancel-${point}`, name: "read", arguments: "{}" }
    : { kind: "text", chunks: ["part-1", "part-2"] }
  const agent = new Agent(`cancel-${point}`, new ScriptedLLM([response]))
  let once = false
  agent.setHook((hookPoint, current) => {
    if (hookPoint === point && !once) {
      once = true
      current.cancel(point)
    }
  })
  agent.followup({ id: `cancel-input-${point}`, content: "cancel me", source: "user" })
  await agent.whenIdle()
  assertBalancedAgent(agent)
  return agent
}

export async function runLesson(): Promise<void> {
  const demo = new Agent("demo", new ScriptedLLM([
    { kind: "tool", chunks: ["plan"], callId: "call-1", name: "read", arguments: "{}" },
    { kind: "text", chunks: ["done"] },
    { kind: "text", chunks: ["followup-done"] },
  ]))
  let injected = false
  let followed = false
  demo.setHook((point, agent, turn, step) => {
    if (point === "pre-step" && turn === 1 && step === 1 && !injected) {
      injected = true
      agent.inject({ id: "inject-1", content: "quiet context", source: "user" })
      agent.steer({ id: "steer-1", content: "change direction", source: "user" })
    }
    if (point === "stream" && turn === 1 && step === 1 && !followed) {
      followed = true
      agent.followup({ id: "followup-1", content: "continue later", source: "user" })
    }
  })
  demo.followup({ id: "prompt-1", content: "start", source: "user" })
  await demo.whenIdle()
  assertBalancedAgent(demo)

  const pre = await runCancellation("pre-step")
  const stream = await runCancellation("stream")
  const tool = await runCancellation("tool")
  await demo.dispose()
  assert(demo.disposed, "agent disposal did not converge")
  expectThrows(() => demo.followup({ id: "after-dispose", content: "no", source: "user" }), "disposed")

  const allEvents = [
    ...tagTrace("normal", demo.trace),
    ...tagTrace("cancel-pre-step", pre.trace),
    ...tagTrace("cancel-stream", stream.trace),
    ...tagTrace("cancel-tool", tool.trace),
  ]
  printResult("03_agent_turn_step_loop", {
    demoTurns: demo.durable.filter(item => item.type === "turn/start").length,
    demoSteps: demo.durable.filter(item => item.type === "step/start").length,
    durableEvents: demo.durable.length,
    liveEvents: demo.live.length,
    inboxSemantics: {
      followup: "next-turn + wake",
      steer: "next-step + wake",
      inject: "next-step + no-wake",
    },
    cancellation: {
      preStep: pre.durable.filter(item => item.type === "step/start").length,
      streamChunks: stream.durable.filter(item => item.type === "assistant/chunk").length,
      toolResults: tool.durable.filter(item => item.type === "tool/result").length,
    },
    disposed: demo.disposed,
  }, allEvents)
}

const entry = process.argv[1] ?? ""
if (entry.endsWith("/03_agent_turn_step_loop/code.ts") || entry.endsWith("\\03_agent_turn_step_loop\\code.ts")) {
  await runLesson()
}
