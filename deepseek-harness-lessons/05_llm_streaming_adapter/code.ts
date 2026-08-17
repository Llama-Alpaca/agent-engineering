import {
  assert,
  deepClone,
  printResult,
  type TraceEvent,
} from "../common/trace.ts"

export type StreamChunk =
  | { readonly kind: "text"; readonly delta: string }
  | { readonly kind: "reasoning"; readonly delta: string }
  | {
      readonly kind: "tool-call"
      readonly callId: string
      readonly name: string
      readonly argumentsDelta: string
    }
  | { readonly kind: "usage"; readonly inputTokens: number; readonly outputTokens: number }
  | { readonly kind: "finish"; readonly reason: "stop" | "tool-call" | "length" }

export interface StreamRequest {
  readonly requestId: string
  readonly provider: string
  readonly model: string
  readonly system: string
  readonly prompt: string
  readonly tools: readonly string[]
  readonly promptTokens: number
  readonly contextWindow: number
  readonly adapterDefaults?: Readonly<Record<string, unknown>>
}

export interface PreparedCall extends StreamRequest {
  readonly route: string
  readonly temperature: number
  readonly stream: true
}

export class AdapterError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = "AdapterError"
    this.code = code
  }
}

export interface LlmAdapter {
  readonly provider: string
  readonly models: readonly string[]
  prepareCall(request: StreamRequest): PreparedCall
  stream(call: PreparedCall, signal?: AbortSignal): AsyncGenerator<unknown>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function abortError(): AdapterError {
  return new AdapterError("CANCELLED", "stream cancelled before commit")
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null) return value
  Object.freeze(value)
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child)
  return value
}

export function normalizeChunk(raw: unknown): StreamChunk {
  if (!isRecord(raw) || typeof raw.kind !== "string") {
    throw new AdapterError("MALFORMED_CHUNK", "chunk must contain a string kind")
  }
  switch (raw.kind) {
    case "text":
    case "reasoning":
      if (typeof raw.delta !== "string") throw new AdapterError("MALFORMED_CHUNK", `${raw.kind}.delta must be a string`)
      return { kind: raw.kind, delta: raw.delta }
    case "tool-call":
      if (
        typeof raw.callId !== "string" ||
        typeof raw.name !== "string" ||
        typeof raw.argumentsDelta !== "string"
      ) {
        throw new AdapterError("MALFORMED_CHUNK", "tool-call requires callId, name and argumentsDelta")
      }
      return {
        kind: "tool-call",
        callId: raw.callId,
        name: raw.name,
        argumentsDelta: raw.argumentsDelta,
      }
    case "usage":
      if (
        typeof raw.inputTokens !== "number" ||
        !Number.isInteger(raw.inputTokens) ||
        typeof raw.outputTokens !== "number" ||
        !Number.isInteger(raw.outputTokens)
      ) {
        throw new AdapterError("MALFORMED_CHUNK", "usage token counts must be integers")
      }
      return { kind: "usage", inputTokens: raw.inputTokens, outputTokens: raw.outputTokens }
    case "finish":
      if (raw.reason !== "stop" && raw.reason !== "tool-call" && raw.reason !== "length") {
        throw new AdapterError("MALFORMED_CHUNK", "finish.reason is invalid")
      }
      return { kind: "finish", reason: raw.reason }
    default:
      throw new AdapterError("MALFORMED_CHUNK", `unknown chunk kind ${raw.kind}`)
  }
}

export interface ToolCallBlock {
  readonly callId: string
  readonly name: string
  readonly arguments: Readonly<Record<string, unknown>>
}

export interface AssembledMessage {
  readonly text: string
  readonly reasoning: string
  readonly toolCalls: readonly ToolCallBlock[]
  readonly usage?: { readonly inputTokens: number; readonly outputTokens: number }
  readonly finishReason: "stop" | "tool-call" | "length"
}

/** Accumulates blocks and only exposes a message after a valid finish marker. */
export class BlockAssembler {
  private text = ""
  private reasoning = ""
  private readonly calls = new Map<string, { name: string; args: string }>()
  private usage: { inputTokens: number; outputTokens: number } | undefined
  private finishReason: AssembledMessage["finishReason"] | undefined
  private committed = false

  feed(chunk: StreamChunk): void {
    assert(!this.committed, "cannot feed a committed assembler")
    if (this.finishReason !== undefined) {
      throw new AdapterError("MALFORMED_CHUNK", `stream emitted ${chunk.kind} after terminal finish`)
    }
    switch (chunk.kind) {
      case "text":
        this.text += chunk.delta
        return
      case "reasoning":
        this.reasoning += chunk.delta
        return
      case "tool-call": {
        const current = this.calls.get(chunk.callId)
        if (current && current.name !== chunk.name) {
          throw new AdapterError("MALFORMED_CHUNK", `tool call ${chunk.callId} changed name`)
        }
        this.calls.set(chunk.callId, {
          name: chunk.name,
          args: (current?.args ?? "") + chunk.argumentsDelta,
        })
        return
      }
      case "usage":
        if (this.usage !== undefined) throw new AdapterError("MALFORMED_CHUNK", "stream emitted usage more than once")
        this.usage = { inputTokens: chunk.inputTokens, outputTokens: chunk.outputTokens }
        return
      case "finish":
        this.finishReason = chunk.reason
    }
  }

  commit(): AssembledMessage {
    assert(!this.committed, "assembler already committed")
    assert(this.finishReason, "stream ended without a finish marker")
    const toolCalls: ToolCallBlock[] = []
    for (const [callId, value] of this.calls) {
      let parsed: unknown
      try {
        parsed = JSON.parse(value.args)
      } catch {
        throw new AdapterError("MALFORMED_ARGUMENTS", `tool call ${callId} has invalid JSON arguments`)
      }
      if (!isRecord(parsed) || Array.isArray(parsed)) {
        throw new AdapterError("MALFORMED_ARGUMENTS", `tool call ${callId} arguments must be an object`)
      }
      toolCalls.push({ callId, name: value.name, arguments: deepClone(parsed) })
    }
    this.committed = true
    return deepFreeze({
      text: this.text,
      reasoning: this.reasoning,
      toolCalls,
      ...(this.usage ? { usage: this.usage } : {}),
      finishReason: this.finishReason,
    })
  }
}

export class DeterministicAdapter implements LlmAdapter {
  readonly provider: string
  readonly models: readonly string[]
  private readonly script: readonly unknown[]
  private readonly failAttempts: number
  private attempts = new Map<string, number>()

  constructor(options: {
    provider?: string
    models?: readonly string[]
    script: readonly unknown[]
    failAttempts?: number
  }) {
    this.provider = options.provider ?? "scripted"
    this.models = options.models ?? ["scripted-model"]
    this.script = deepClone(options.script)
    this.failAttempts = options.failAttempts ?? 0
  }

  prepareCall(request: StreamRequest): PreparedCall {
    assert(request.provider === this.provider, `no route for provider ${request.provider}`)
    assert(this.models.includes(request.model), `no route for model ${request.model}`)
    if (request.promptTokens > request.contextWindow) {
      throw new AdapterError(
        "CONTEXT_OVERFLOW",
        `prompt tokens ${request.promptTokens} exceed context window ${request.contextWindow}`,
      )
    }
    const defaults = request.adapterDefaults ?? {}
    const temperature = typeof defaults.temperature === "number" ? defaults.temperature : 0
    const prepared = {
      ...deepClone(request),
      route: `${this.provider}/${request.model}`,
      temperature,
      stream: true as const,
    }
    return deepFreeze(prepared)
  }

  async *stream(call: PreparedCall, signal?: AbortSignal): AsyncGenerator<unknown> {
    const attempt = (this.attempts.get(call.requestId) ?? 0) + 1
    this.attempts.set(call.requestId, attempt)
    if (attempt <= this.failAttempts) throw new AdapterError("TRANSIENT", `scripted transport failure ${attempt}`)
    for (const raw of this.script) {
      if (signal?.aborted) throw abortError()
      yield deepClone(raw)
    }
  }
}

export interface StreamOutcome {
  readonly status: "ok" | "error" | "cancelled"
  readonly message?: AssembledMessage
  readonly error?: { readonly code: string; readonly message: string }
  readonly committed: boolean
  readonly chunksSeen: number
  readonly events: readonly TraceEvent[]
}

function normalizeError(error: unknown): { code: string; message: string } {
  if (error instanceof AdapterError) return { code: error.code, message: error.message }
  if (error instanceof Error) return { code: "ADAPTER_ERROR", message: error.message }
  return { code: "ADAPTER_ERROR", message: String(error) }
}

export async function collectStream(
  adapter: LlmAdapter,
  request: StreamRequest,
  options: {
    readonly signal?: AbortSignal
    readonly onChunk?: (chunk: StreamChunk, index: number) => void | Promise<void>
    readonly onCommit?: (message: AssembledMessage) => void | Promise<void>
  } = {},
): Promise<StreamOutcome> {
  const trace: TraceEvent[] = []
  let chunksSeen = 0
  const assembler = new BlockAssembler()
  try {
    const prepared = adapter.prepareCall(request)
    trace.push({ type: "prepare-call", data: { route: prepared.route, temperature: prepared.temperature } })
    for await (const raw of adapter.stream(prepared, options.signal)) {
      if (options.signal?.aborted) throw abortError()
      const chunk = normalizeChunk(raw)
      chunksSeen += 1
      assembler.feed(chunk)
      trace.push({ type: "chunk", data: { index: chunksSeen, kind: chunk.kind } })
      await options.onChunk?.(chunk, chunksSeen)
      if (options.signal?.aborted) throw abortError()
    }
    if (options.signal?.aborted) throw abortError()
    const message = assembler.commit()
    await options.onCommit?.(message)
    trace.push({ type: "commit", data: { toolCalls: message.toolCalls.length, finish: message.finishReason } })
    return { status: "ok", message, committed: true, chunksSeen, events: trace }
  } catch (error) {
    const normalized = normalizeError(error)
    const cancelled = normalized.code === "CANCELLED" || options.signal?.aborted === true
    trace.push({ type: cancelled ? "cancel" : "error", data: normalized })
    return {
      status: cancelled ? "cancelled" : "error",
      error: normalized,
      committed: false,
      chunksSeen,
      events: trace,
    }
  }
}

export async function collectWithRetry(
  adapter: LlmAdapter,
  request: StreamRequest,
  maxAttempts: number,
): Promise<StreamOutcome & { readonly attempts: number }> {
  assert(maxAttempts >= 1 && Number.isInteger(maxAttempts), "maxAttempts must be a positive integer")
  let last: StreamOutcome | undefined
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const outcome = await collectStream(adapter, request)
    if (outcome.status === "ok") return { ...outcome, attempts: attempt }
    last = outcome
    if (outcome.error?.code !== "TRANSIENT") return { ...outcome, attempts: attempt }
  }
  assert(last, "retry did not execute")
  return { ...last, attempts: maxAttempts }
}

export function happyScript(): readonly unknown[] {
  return [
    { kind: "reasoning", delta: "Check release notes. " },
    { kind: "text", delta: "The " },
    { kind: "text", delta: "release is ready." },
    { kind: "tool-call", callId: "call-1", name: "read_file", argumentsDelta: '{"path":"REL' },
    { kind: "tool-call", callId: "call-1", name: "read_file", argumentsDelta: 'EASE.md"}' },
    { kind: "usage", inputTokens: 42, outputTokens: 17 },
    { kind: "finish", reason: "tool-call" },
  ]
}

export interface LessonFacts {
  readonly happy: {
    status: StreamOutcome["status"]
    text: string
    reasoning: string
    toolArguments: Readonly<Record<string, unknown>>
    usage: { inputTokens: number; outputTokens: number }
    preparedDefaults: number
  }
  readonly malformed: { code: string; message: string; committed: boolean }
  readonly retry: { status: StreamOutcome["status"]; attempts: number; committed: boolean }
  readonly overflow: { code: string; committed: boolean }
  readonly cancelled: { status: StreamOutcome["status"]; committed: boolean; chunksSeen: number }
}

export async function runLesson(): Promise<LessonFacts> {
  const request: StreamRequest = {
    requestId: "req-stream-1",
    provider: "scripted",
    model: "scripted-model",
    system: "Be concise.",
    prompt: "Summarize release notes",
    tools: ["read_file"],
    promptTokens: 42,
    contextWindow: 128,
    adapterDefaults: { temperature: 0, stream: true },
  }
  const adapter = new DeterministicAdapter({ script: happyScript() })
  let committedToolCalls = 0
  const happy = await collectStream(adapter, request, {
    onCommit: (message) => {
      committedToolCalls = message.toolCalls.length
    },
  })
  assert(happy.status === "ok" && happy.message, "happy stream should commit")
  assert(committedToolCalls === 1, "tool call should commit exactly once")
  const happyMessage = happy.message
  assert(happyMessage.usage, "trailing usage should be retained")

  const malformed = await collectStream(
    new DeterministicAdapter({ script: [{ kind: "wat", delta: "ignored" }, { kind: "finish", reason: "stop" }] }),
    request,
  )
  assert(malformed.status === "error" && malformed.error?.code === "MALFORMED_CHUNK", "malformed chunk must fail")
  assert(!malformed.committed, "malformed stream cannot commit")

  const retry = await collectWithRetry(
    new DeterministicAdapter({ script: happyScript(), failAttempts: 1 }),
    { ...request, requestId: "req-retry" },
    2,
  )
  assert(retry.status === "ok" && retry.attempts === 2, "transient failure should retry once")

  const overflow = await collectStream(
    adapter,
    { ...request, requestId: "req-overflow", promptTokens: 129, contextWindow: 128 },
  )
  assert(overflow.status === "error" && overflow.error?.code === "CONTEXT_OVERFLOW", "overflow must be explicit")

  const controller = new AbortController()
  const cancelled = await collectStream(adapter, { ...request, requestId: "req-cancel" }, {
    signal: controller.signal,
    onChunk: (_chunk, index) => {
      if (index === 1) controller.abort()
    },
  })
  assert(cancelled.status === "cancelled" && !cancelled.committed, "cancelled stream must not commit")

  const malformedArgs = await collectStream(
    new DeterministicAdapter({
      script: [
        { kind: "tool-call", callId: "bad-call", name: "read_file", argumentsDelta: "{bad" },
        { kind: "finish", reason: "tool-call" },
      ],
    }),
    { ...request, requestId: "req-bad-args" },
  )
  assert(malformedArgs.status === "error", "malformed arguments should fail")
  assert(malformedArgs.error?.code === "MALFORMED_ARGUMENTS", "malformed arguments should be normalized")

  const facts: LessonFacts = {
    happy: {
      status: happy.status,
      text: happyMessage.text,
      reasoning: happyMessage.reasoning,
      toolArguments: happyMessage.toolCalls[0]?.arguments ?? {},
      usage: happyMessage.usage,
      preparedDefaults: 0,
    },
    malformed: {
      code: malformed.error?.code ?? "",
      message: malformed.error?.message ?? "",
      committed: malformed.committed,
    },
    retry: { status: retry.status, attempts: retry.attempts, committed: retry.committed },
    overflow: { code: overflow.error?.code ?? "", committed: overflow.committed },
    cancelled: { status: cancelled.status, committed: cancelled.committed, chunksSeen: cancelled.chunksSeen },
  }
  const events: TraceEvent[] = [
    ...happy.events,
    { type: "retry", data: { attempts: retry.attempts, committed: retry.committed } },
    { type: "malformed", data: malformed.error ?? {} },
    { type: "overflow", data: overflow.error ?? {} },
    { type: "cancel", data: { chunksSeen: cancelled.chunksSeen, committed: cancelled.committed } },
  ]
  printResult("05_llm_streaming_adapter", { ...facts }, events)
  return facts
}

if (process.argv[1]?.endsWith("code.ts")) void runLesson()
