import {
  assert,
  deepClone,
  expectThrows,
  printResult,
  type JsonValue,
  type TraceEvent,
} from "../common/trace.ts"

/**
 * A compact model of the pinned Session contract.  The upstream envelope uses
 * zero-based contiguous `seq` values.  Surface placement is metadata on a
 * surface-eligible event; it is not a separate `surface/replace` event type.
 */
export type SurfaceOp = "append" | { readonly op: "replace"; readonly start: number; readonly end: number }

export interface Message {
  readonly id: string
  readonly role: "system" | "user" | "assistant" | "tool"
  readonly content: string
}

export interface SessionEvent {
  readonly seq: number
  readonly type: string
  readonly data: Record<string, JsonValue>
  readonly surfaceOp?: SurfaceOp
  readonly sourceEventSeqs?: readonly number[]
}

export type EventInput = Omit<SessionEvent, "seq">

export interface SessionLineage {
  readonly sessionId: string
  readonly parentSessionId?: string
  readonly forkedAt?: number
}

const SURFACE_TYPES = new Set(["user/message", "assistant/message", "tool/result"])

function asMessage(value: unknown): Message {
  assert(typeof value === "object" && value !== null, "message must be an object")
  const candidate = value as Record<string, unknown>
  assert(typeof candidate.id === "string", "message id must be a string")
  assert(candidate.role === "system" || candidate.role === "user" || candidate.role === "assistant" || candidate.role === "tool", `unsupported message role: ${String(candidate.role)}`)
  assert(typeof candidate.content === "string", "message content must be a string")
  return { id: candidate.id, role: candidate.role, content: candidate.content }
}

function messageOf(event: SessionEvent): Message | undefined {
  if (!SURFACE_TYPES.has(event.type)) return undefined
  return asMessage(event.data.message)
}

function cloneEventInput(input: EventInput): EventInput {
  return deepClone(input)
}

export class EventLog {
  private readonly entries: SessionEvent[]
  readonly lineage: SessionLineage

  constructor(initial: readonly SessionEvent[] = [], lineage: SessionLineage = { sessionId: "session-1" }) {
    this.entries = initial.map((event) => deepClone(event))
    this.lineage = deepClone(lineage)
    this.assertSequence()
    this.assertSurfaceMetadata()
  }

  get size(): number {
    return this.entries.length
  }

  get lastSeq(): number {
    return this.entries.length - 1
  }

  /** Append is the only mutating operation; existing entries are never edited. */
  append(input: EventInput): SessionEvent {
    const event = deepClone({ ...cloneEventInput(input), seq: this.entries.length }) as SessionEvent
    this.validateEvent(event)
    this.entries.push(event)
    // Validate the fold after the append. If it fails, roll back the append so
    // callers never observe a half-accepted durable transition.
    try {
      this.assertSurfaceMetadata()
    } catch (error) {
      this.entries.pop()
      throw error
    }
    return deepClone(event)
  }

  snapshot(): readonly SessionEvent[] {
    return deepClone(this.entries)
  }

  toJsonl(): string {
    return this.entries.map((event) => JSON.stringify(event)).join("\n")
  }

  static fromJsonl(jsonl: string, lineage: SessionLineage): EventLog {
    const events = jsonl
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as SessionEvent)
    return new EventLog(events, lineage)
  }

  /** The pinned API treats the boundary as inclusive: child gets seq <= boundary. */
  fork(boundary: number, childSessionId: string): EventLog {
    assert(Number.isInteger(boundary) && boundary >= 0 && boundary <= this.lastSeq, "invalid fork boundary")
    const prefix = this.entries.slice(0, boundary + 1)
    return new EventLog(prefix, {
      sessionId: childSessionId,
      parentSessionId: this.lineage.sessionId,
      forkedAt: boundary,
    })
  }

  private validateEvent(event: SessionEvent): void {
    if (!SURFACE_TYPES.has(event.type)) {
      assert(event.surfaceOp === undefined, `${event.type} cannot carry surfaceOp`)
      assert(event.sourceEventSeqs === undefined, `${event.type} cannot carry sourceEventSeqs`)
      return
    }
    assert(event.surfaceOp !== undefined, `${event.type} requires surfaceOp`)
    if (event.surfaceOp !== "append") {
      assert(Number.isInteger(event.surfaceOp.start) && Number.isInteger(event.surfaceOp.end), "replace range must use integer seqs")
      assert(event.surfaceOp.start <= event.surfaceOp.end, "replace range is inverted")
      assert(Array.isArray(event.sourceEventSeqs), "replace requires sourceEventSeqs")
    }
    if (event.sourceEventSeqs !== undefined) {
      event.sourceEventSeqs.forEach((seq) => assert(Number.isInteger(seq) && seq >= 0 && seq < event.seq, "sourceEventSeqs must cite earlier events"))
    }
  }

  private assertSequence(): void {
    this.entries.forEach((event, index) => assert(event.seq === index, `non-contiguous seq at ${index}; expected ${index}`))
  }

  private assertSurfaceMetadata(): void {
    const surface: number[] = []
    for (const event of this.entries) {
      this.validateEvent(event)
      if (!SURFACE_TYPES.has(event.type)) continue
      const op = event.surfaceOp!
      if (op === "append") {
        surface.push(event.seq)
        continue
      }
      const start = surface.indexOf(op.start)
      const end = surface.indexOf(op.end)
      assert(start >= 0, `surface replace start seq ${op.start} is not present`)
      assert(end >= start, `surface replace end seq ${op.end} is before start`)
      const shadowed = surface.slice(start, end + 1)
      const sources = new Set(event.sourceEventSeqs ?? [])
      shadowed.forEach((seq) => assert(sources.has(seq), `surface replace must cite shadowed seq ${seq}`))
      surface.splice(start, end - start + 1, event.seq)
    }
  }
}

export interface SurfaceState {
  readonly messages: readonly (Message & { readonly sourceSeq: number })[]
  readonly nodes: readonly number[]
  readonly replacementCount: number
}

/** Replay the ordered model-visible surface from the append-only log. */
export function projectSurface(source: EventLog | readonly SessionEvent[]): SurfaceState {
  const events = source instanceof EventLog ? source.snapshot() : source
  const bySeq = new Map(events.map((event) => [event.seq, event]))
  const nodes: number[] = []
  let replacementCount = 0
  for (const event of events) {
    const message = messageOf(event)
    if (message === undefined) continue
    const op = event.surfaceOp
    assert(op !== undefined, `${event.type} is missing surfaceOp`)
    if (op === "append") {
      nodes.push(event.seq)
      continue
    }
    const start = nodes.indexOf(op.start)
    const end = nodes.indexOf(op.end)
    assert(start >= 0 && end >= start, `surface replacement range ${op.start}:${op.end} is not live`)
    const shadowed = nodes.slice(start, end + 1)
    const sources = new Set(event.sourceEventSeqs ?? [])
    shadowed.forEach((seq) => assert(sources.has(seq), `replacement ${event.seq} omitted source seq ${seq}`))
    nodes.splice(start, end - start + 1, event.seq)
    replacementCount += 1
  }
  const messages = nodes.map((seq) => {
    const event = bySeq.get(seq)
    assert(event !== undefined, `surface node ${seq} is missing from log`)
    const message = messageOf(event)
    assert(message !== undefined, `surface node ${seq} is not a message event`)
    return { ...message, sourceSeq: seq }
  })
  return { messages: deepClone(messages), nodes: [...nodes], replacementCount }
}

export function deriveMessages(source: EventLog | readonly SessionEvent[]): readonly (Message & { readonly sourceSeq: number })[] {
  return projectSurface(source).messages
}

export interface RequestHeader extends Readonly<Record<string, JsonValue>> {
  readonly requestId: string
  readonly provider: string
  readonly model: string
  readonly system: string
  readonly tools: readonly string[]
  readonly adapterDefaults: Readonly<Record<string, JsonValue>>
  readonly visibleMessageIds: readonly string[]
}

function headerOf(value: unknown): RequestHeader {
  assert(typeof value === "object" && value !== null, "request/header.data.header is required")
  const raw = value as Record<string, unknown>
  assert(typeof raw.requestId === "string", "request/header.requestId is required")
  assert(typeof raw.provider === "string", "request/header.provider is required")
  assert(typeof raw.model === "string", "request/header.model is required")
  assert(typeof raw.system === "string", "request/header.system is required")
  const tools = Array.isArray(raw.tools) ? raw.tools.filter((tool): tool is string => typeof tool === "string") : []
  const visibleMessageIds = Array.isArray(raw.visibleMessageIds)
    ? raw.visibleMessageIds.filter((id): id is string => typeof id === "string")
    : []
  const adapterDefaults = typeof raw.adapterDefaults === "object" && raw.adapterDefaults !== null
    ? (deepClone(raw.adapterDefaults) as Record<string, JsonValue>)
    : {}
  return {
    requestId: raw.requestId,
    provider: raw.provider,
    model: raw.model,
    system: raw.system,
    tools,
    adapterDefaults,
    visibleMessageIds,
  }
}

export function deriveRequestHeader(events: readonly SessionEvent[]): RequestHeader | undefined {
  const event = [...events].reverse().find((candidate) => candidate.type === "request/header")
  return event === undefined ? undefined : headerOf(event.data.header)
}

export interface ReconstructionRequest {
  readonly requestId: string
  readonly visibleMessages: readonly Message[]
  /** The durable prefix at which the request was assembled. */
  readonly atSeq?: number
}

/** Check the loop invariant without inventing a durable request/reconstruct event. */
export function assertRequestReconstructable(source: EventLog | readonly SessionEvent[], request: ReconstructionRequest): void {
  const all = source instanceof EventLog ? source.snapshot() : source
  const atSeq = request.atSeq ?? (all.at(-1)?.seq ?? -1)
  const prefix = all.filter((event) => event.seq <= atSeq)
  const header = deriveRequestHeader(prefix)
  assert(header !== undefined, `request ${request.requestId} has no durable request/header`)
  assert(header.requestId === request.requestId, `request ${request.requestId} does not match durable header`)
  const expected = deriveMessages(prefix)
  const expectedIds = expected.map((message) => message.id)
  assert(JSON.stringify(header.visibleMessageIds) === JSON.stringify(expectedIds), `request ${request.requestId} header visibleMessageIds diverge from replay`)
  assert(request.visibleMessages.length === expected.length, `request ${request.requestId} references unlogged or stale message ids`)
  request.visibleMessages.forEach((message, index) => {
    const target = expected[index]
    assert(target !== undefined && message.id === target.id, `request ${request.requestId} references unlogged or stale message ids`)
    assert(message.role === target.role && message.content === target.content, `request ${request.requestId} content differs from replay at index ${index}`)
  })
}

export interface Fixture {
  readonly log: EventLog
  readonly requestHeader: RequestHeader
  readonly requestAtSeq: number
}

export function buildFixture(): Fixture {
  const log = new EventLog([], { sessionId: "parent" })
  log.append({ type: "session/start", data: { sessionId: "parent", createdAt: "2026-01-01T00:00:00Z" } })
  log.append({
    type: "user/message",
    surfaceOp: "append",
    data: { message: { id: "u1", role: "user", content: "Summarize the release notes." } },
  })
  const header: RequestHeader = {
    requestId: "req-1",
    provider: "deepseek",
    model: "deepseek-chat",
    system: "You are concise.",
    tools: ["read_file"],
    adapterDefaults: { temperature: 0, stream: true },
    visibleMessageIds: ["u1"],
  }
  log.append({ type: "request/header", data: { header } })
  const requestAtSeq = log.lastSeq
  assertRequestReconstructable(log, { requestId: "req-1", visibleMessages: deriveMessages(log), atSeq: requestAtSeq })
  log.append({
    type: "assistant/message",
    surfaceOp: "append",
    data: { message: { id: "a1", role: "assistant", content: "I will inspect the notes." } },
  })
  log.append({ type: "tool/call", data: { callId: "call-1", name: "read_file", arguments: { path: "RELEASE.md" } } })
  log.append({
    type: "tool/result",
    surfaceOp: "append",
    data: { callId: "call-1", message: { id: "tool-1", role: "tool", content: JSON.stringify({ lines: 12, status: "ok" }) } },
  })
  log.append({
    type: "assistant/message",
    surfaceOp: "append",
    data: { message: { id: "a2", role: "assistant", content: "The release adds event replay." } },
  })
  log.append({
    type: "assistant/message",
    surfaceOp: { op: "replace", start: 1, end: 6 },
    sourceEventSeqs: [1, 3, 5, 6],
    data: { message: { id: "summary-1", role: "assistant", content: "Earlier turn compacted: release notes inspected; event replay added." } },
  })
  const requestHeader = deriveRequestHeader(log.snapshot())
  assert(requestHeader !== undefined, "fixture header missing")
  return { log, requestHeader, requestAtSeq }
}

export interface LessonFacts {
  readonly rawEventTypes: readonly string[]
  readonly rawEventCount: number
  readonly seqBase: number
  readonly surfaceMessagesBeforeReplacement: readonly (Message & { readonly sourceSeq: number })[]
  readonly surfaceMessagesAfterReplacement: readonly (Message & { readonly sourceSeq: number })[]
  readonly requestHeader: RequestHeader
  readonly resumeEqual: boolean
  readonly fork: { parentSessionId?: string; childSessionId: string; childSize: number; parentSizeAfterChildAppend: number; boundary: number }
  readonly negativeInvariant: string
}

export function runLesson(): LessonFacts {
  const { log, requestHeader, requestAtSeq } = buildFixture()
  const raw = log.snapshot()
  const beforeReplacement = deriveMessages(raw.filter((event) => event.seq <= 6))
  const afterReplacement = deriveMessages(log)

  assert(raw[0]?.seq === 0, "session sequence must start at zero")
  const resumed = EventLog.fromJsonl(log.toJsonl(), log.lineage)
  const resumeEqual = JSON.stringify(resumed.snapshot()) === JSON.stringify(log.snapshot())
  assert(resumeEqual, "JSONL resume changed the raw log")

  const forkBoundary = 4
  const fork = log.fork(forkBoundary, "child-1")
  const parentSize = log.size
  fork.append({ type: "user/message", surfaceOp: "append", data: { message: { id: "child-u1", role: "user", content: "Use bullet points." } } })
  assert(log.size === parentSize, "child append polluted parent log")

  let negativeInvariant = ""
  expectThrows(() => assertRequestReconstructable(log, {
    requestId: "req-1",
    atSeq: requestAtSeq,
    visibleMessages: [...deriveMessages(raw.filter((event) => event.seq <= requestAtSeq)), { id: "ghost", role: "user", content: "This was never appended." }],
  }), "unlogged")
  try {
    assertRequestReconstructable(log, {
      requestId: "req-1",
      atSeq: requestAtSeq,
      visibleMessages: [...deriveMessages(raw.filter((event) => event.seq <= requestAtSeq)), { id: "ghost", role: "user", content: "This was never appended." }],
    })
  } catch (error) {
    negativeInvariant = error instanceof Error ? error.message : String(error)
  }

  const events: TraceEvent[] = [
    { type: "session/log", data: { count: raw.length, appendOnly: true, seqBase: 0 } },
    { type: "surface/project", data: { before: beforeReplacement.length, after: afterReplacement.length, replacements: projectSurface(raw).replacementCount } },
    { type: "session/resume", data: { jsonl: true, equal: resumeEqual } },
    { type: "session/fork", data: { parent: log.lineage.sessionId, child: fork.lineage.sessionId, boundary: forkBoundary } },
    { type: "invariant/reject", data: { message: negativeInvariant } },
  ]
  const facts: LessonFacts = {
    rawEventTypes: raw.map((event) => event.type),
    rawEventCount: raw.length,
    seqBase: raw[0]?.seq ?? -1,
    surfaceMessagesBeforeReplacement: beforeReplacement,
    surfaceMessagesAfterReplacement: afterReplacement,
    requestHeader,
    resumeEqual,
    fork: {
      parentSessionId: fork.lineage.parentSessionId,
      childSessionId: fork.lineage.sessionId,
      childSize: fork.size,
      parentSizeAfterChildAppend: log.size,
      boundary: fork.lineage.forkedAt ?? forkBoundary,
    },
    negativeInvariant,
  }
  // Keep the request prefix in the trace so learners can compare it to the
  // later surface replacement without treating the header as a new message.
  events.push({ type: "request/reconstructed", data: { requestId: requestHeader.requestId, atSeq: requestAtSeq, visible: [...requestHeader.visibleMessageIds] } })
  printResult("04_session_event_sourcing", { ...facts }, events)
  return facts
}

if (process.argv[1]?.endsWith("/04_session_event_sourcing/code.ts") || process.argv[1]?.endsWith("\\04_session_event_sourcing\\code.ts")) {
  runLesson()
}
