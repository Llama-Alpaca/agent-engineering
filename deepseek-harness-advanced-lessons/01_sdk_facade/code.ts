/**
 * L01 - SDK receipt, notification, and activity-interval semantics.
 *
 * The real `session/prompt` response contains only a durable user-message id.
 * A high-level run subscribes before prompting, ignores unrelated/stale idle
 * frames until it observes `agent/inbox/spliced` for that id, then owns every
 * notification through the root session's next idle transition.
 */

import { assert, deepClone, printResult, type JsonValue } from "../../deepseek-harness-lessons/common/trace.ts"

export const WIRE_REQUEST_METHODS = ["initialize", "session/prompt", "shutdown"] as const

export type ContentBlock =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "image"; readonly attachment: string }

export interface SessionEvent {
  readonly type: string
  readonly data: Record<string, unknown>
}

export type HarnessNotification =
  | { readonly method: "session.event"; readonly params: { readonly sessionId: string; readonly event: SessionEvent } }
  | { readonly method: "session.status"; readonly params: { readonly sessionId: string; readonly status: "idle" | "running" } }
  | { readonly method: "subagent.started"; readonly params: { readonly parentSessionId: string; readonly childSessionId: string } }
  | { readonly method: "subagent.finished"; readonly params: { readonly parentSessionId: string; readonly childSessionId: string; readonly status: "ok" | "error" } }

export interface RunResult {
  readonly sessionId: string
  readonly messageId: string
  readonly finalResponse: string
  readonly events: readonly SessionEvent[]
  readonly notifications: readonly HarnessNotification[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export class SdkProtocolError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "SdkProtocolError"
  }
}

export class NotificationSubscription {
  private readonly queue: HarnessNotification[] = []
  private readonly waiters: ((value: HarnessNotification) => void)[] = []
  private closed = false

  push(notification: HarnessNotification): void {
    if (this.closed) return
    const waiter = this.waiters.shift()
    if (waiter === undefined) this.queue.push(deepClone(notification))
    else waiter(deepClone(notification))
  }

  next(): Promise<HarnessNotification> {
    if (this.queue.length > 0) return Promise.resolve(this.queue.shift() as HarnessNotification)
    if (this.closed) return Promise.reject(new Error("notification subscription closed"))
    return new Promise((resolve) => this.waiters.push(resolve))
  }

  close(): void {
    this.closed = true
    this.queue.length = 0
  }
}

interface SessionTreeSubscription {
  readonly raw: NotificationSubscription
  readonly tree: NotificationSubscription
  readonly sessions: Set<string>
}

/** In-process wire fixture: the response and notification planes stay separate. */
export class FakeSdkRuntime {
  private readonly subscriptions = new Set<SessionTreeSubscription>()
  private nextMessage = 0
  private initialized = false
  private closed = false

  initialize(): { readonly serverInfo: { readonly name: string; readonly version: string } } {
    assert(!this.closed && !this.initialized, "runtime can initialize exactly once")
    this.initialized = true
    return { serverInfo: { name: "deepseek-harness-sdk-runtime", version: "0.1.0-rc.7" } }
  }

  subscribeSessionTree(sessionId: string): NotificationSubscription {
    const subscription: SessionTreeSubscription = {
      raw: new NotificationSubscription(),
      tree: new NotificationSubscription(),
      sessions: new Set([sessionId]),
    }
    this.subscriptions.add(subscription)
    const close = subscription.tree.close.bind(subscription.tree)
    subscription.tree.close = () => {
      this.subscriptions.delete(subscription)
      subscription.raw.close()
      close()
    }
    return subscription.tree
  }

  /** Durable receipt only. The scripted activity arrives on notifications. */
  prompt(sessionId: string, contentBlocks: readonly ContentBlock[]): { readonly messageId: string } {
    assert(this.initialized && !this.closed, "runtime is not initialized")
    assert(contentBlocks.length > 0, "prompt must contain content")
    const messageId = `message-${this.nextMessage++}`
    this.emit({ method: "session.status", params: { sessionId, status: "idle" } })
    this.emit({ method: "session.event", params: { sessionId: "other-session", event: { type: "assistant/message", data: { text: "unrelated" } } } })
    this.emit({
      method: "session.event",
      params: { sessionId, event: { type: "agent/inbox/spliced", data: { inserted: [{ id: messageId, content: contentBlocks }] } } },
    })
    this.emit({ method: "session.status", params: { sessionId, status: "running" } })
    const childSessionId = `${sessionId}/child`
    this.emit({ method: "subagent.started", params: { parentSessionId: sessionId, childSessionId } })
    this.emit({ method: "session.event", params: { sessionId: childSessionId, event: { type: "assistant/message", data: { message: { content: [{ type: "text", text: "child evidence" }] } } } } })
    this.emit({ method: "subagent.finished", params: { parentSessionId: sessionId, childSessionId, status: "ok" } })
    this.emit({ method: "session.event", params: { sessionId, event: { type: "assistant/message", data: { message: { content: [{ type: "text", text: "root answer" }, { type: "image", attachment: "image-1" }, { type: "text", text: " complete" }] } } } } })
    this.emit({ method: "session.status", params: { sessionId, status: "idle" } })
    return { messageId }
  }

  shutdown(): Record<string, never> {
    this.closed = true
    for (const subscription of this.subscriptions) subscription.tree.close()
    this.subscriptions.clear()
    return {}
  }

  emit(notification: HarnessNotification): void {
    for (const subscription of this.subscriptions) {
      subscription.raw.push(notification)
      if (notification.method === "subagent.started" && subscription.sessions.has(notification.params.parentSessionId)) {
        subscription.sessions.add(notification.params.childSessionId)
        subscription.tree.push(notification)
        continue
      }
      if (notification.method === "subagent.finished") {
        if (subscription.sessions.has(notification.params.childSessionId)) subscription.tree.push(notification)
        continue
      }
      if (notification.method === "session.event" || notification.method === "session.status") {
        if (subscription.sessions.has(notification.params.sessionId)) subscription.tree.push(notification)
      }
    }
  }
}

function inboxReceipt(event: SessionEvent, messageId: string): boolean {
  if (event.type !== "agent/inbox/spliced") return false
  const inserted = event.data.inserted
  return Array.isArray(inserted) && inserted.some((message) => isRecord(message) && message.id === messageId)
}

export function finalResponse(events: readonly SessionEvent[]): string {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type !== "assistant/message") continue
    const message = event.data.message
    const content = isRecord(message) ? message.content : undefined
    if (!Array.isArray(content)) throw new SdkProtocolError("assistant/message event carried malformed content")
    return content
      .filter((block): block is Record<string, unknown> => isRecord(block) && block.type === "text")
      .map((block) => typeof block.text === "string" ? block.text : "")
      .join("")
  }
  return ""
}

export class HarnessSession {
  readonly id: string
  private readonly runtime: FakeSdkRuntime

  constructor(runtime: FakeSdkRuntime, id: string) {
    this.runtime = runtime
    this.id = id
  }

  async run(input: string | readonly ContentBlock[], onNotification?: (notification: HarnessNotification) => void): Promise<RunResult> {
    const blocks: readonly ContentBlock[] = typeof input === "string" ? [{ type: "text", text: input }] : input
    const subscription = this.runtime.subscribeSessionTree(this.id)
    const events: SessionEvent[] = []
    const notifications: HarnessNotification[] = []
    const { messageId } = this.runtime.prompt(this.id, blocks)
    let received = false
    try {
      while (true) {
        const notification = await subscription.next()
        if (!received) {
          if (notification.method !== "session.event"
            || notification.params.sessionId !== this.id
            || !inboxReceipt(notification.params.event, messageId)) continue
          received = true
        }
        notifications.push(deepClone(notification))
        onNotification?.(deepClone(notification))
        if (notification.method === "session.event" && notification.params.sessionId === this.id) {
          events.push(deepClone(notification.params.event))
        }
        if (notification.method === "session.status"
          && notification.params.sessionId === this.id
          && notification.params.status === "idle") break
      }
    } finally {
      subscription.close()
    }
    return { sessionId: this.id, messageId, finalResponse: finalResponse(events), events, notifications }
  }
}

export interface TeardownOutcome {
  readonly actions: readonly string[]
  readonly reaped: boolean
}

/** Teaching model of the client's EOF -> SIGTERM -> SIGKILL fallback ladder. */
export function disposeRuntimeProcess(exitAt: "shutdown" | "eof" | "term" | "kill"): TeardownOutcome {
  const actions = ["shutdown-request"]
  if (exitAt === "shutdown") return { actions, reaped: true }
  actions.push("stdin-eof")
  if (exitAt === "eof") return { actions, reaped: true }
  actions.push("SIGTERM")
  if (exitAt === "term") return { actions, reaped: true }
  actions.push("SIGKILL")
  return { actions, reaped: exitAt === "kill" }
}

export async function runSdkLab(): Promise<Record<string, JsonValue>> {
  const runtime = new FakeSdkRuntime()
  const initialized = runtime.initialize()
  const observed: string[] = []
  const result = await new HarnessSession(runtime, "sdk-demo").run("inspect", (notification) => observed.push(notification.method))
  const teardown = disposeRuntimeProcess("kill")
  runtime.shutdown()
  return {
    server: initialized.serverInfo.name,
    wireMethods: [...WIRE_REQUEST_METHODS],
    messageId: result.messageId,
    finalResponse: result.finalResponse,
    rootEvents: result.events.map((event) => event.type),
    observed,
    childIncluded: result.notifications.some((notification) => notification.method === "session.event" && notification.params.sessionId.endsWith("/child")),
    staleIdleExcluded: result.notifications[0]?.method === "session.event",
    teardown: teardown.actions,
  }
}

export async function runLesson(): Promise<void> {
  const facts = await runSdkLab()
  assert(facts.finalResponse === "root answer complete", "final response must come from the owned interval")
  assert(facts.staleIdleExcluded === true, "idle before the receipt ended the wrong interval")
  assert(facts.childIncluded === true, "session-tree subscription dropped a child")
  printResult("advanced-01-sdk-receipt-interval", facts)
}

const entry = process.argv[1] ?? ""
if (entry.endsWith("/01_sdk_facade/code.ts") || entry.endsWith("\\01_sdk_facade\\code.ts")) await runLesson()
