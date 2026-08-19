/**
 * L02 - host projections and incremental client assembly.
 *
 * Whole-value domain projections are computed on the host. The client stores
 * `key -> { value, seq }` under one rule: higher seq wins. Conversation rows
 * use a separate contiguous event window that can be replaced, appended, or
 * prepended without changing the identity of already assembled nodes.
 */

import { assert, deepClone, printResult, type JsonValue } from "../../deepseek-harness-lessons/common/trace.ts"

export interface ProjectionBaseline {
  readonly asOfSeq: number
  readonly values: Readonly<Record<string, JsonValue>>
}

interface ProjectionRow {
  readonly value: JsonValue
  readonly seq: number
}

export class ProjectionValueStore {
  private readonly rows = new Map<string, ProjectionRow>()

  apply(key: string, value: JsonValue, seq: number): boolean {
    const row = this.rows.get(key)
    if (row !== undefined && seq <= row.seq) return false
    this.rows.set(key, { value: deepClone(value), seq })
    return true
  }

  /** Omitted keys are absent at the cut, unless a newer push already won. */
  seed(baseline: ProjectionBaseline): void {
    for (const [key, value] of Object.entries(baseline.values)) this.apply(key, value, baseline.asOfSeq)
    for (const [key, row] of this.rows) {
      if (Object.hasOwn(baseline.values, key) || row.seq > baseline.asOfSeq) continue
      this.rows.delete(key)
    }
  }

  /** Drop values that claim knowledge beyond a restarted host's durable cut. */
  truncate(lastSeq: number): void {
    for (const [key, row] of this.rows) if (row.seq > lastSeq) this.rows.delete(key)
  }

  get(key: string): JsonValue | undefined {
    const row = this.rows.get(key)
    return row === undefined ? undefined : deepClone(row.value)
  }

  seqOf(key: string): number | undefined {
    return this.rows.get(key)?.seq
  }

  values(): Readonly<Record<string, JsonValue>> {
    return Object.fromEntries([...this.rows].map(([key, row]) => [key, deepClone(row.value)]))
  }
}

export interface WindowEvent {
  readonly seq: number
  readonly type: "message" | "tool/start" | "tool/end"
  readonly id: string
  readonly text?: string
  readonly parentCallId?: string
}

export interface ConversationNode {
  readonly key: string
  readonly startSeq: number
  readonly kind: "message" | "tool"
  readonly id: string
  readonly text: string
  readonly complete: boolean
}

function assertUnique(events: readonly WindowEvent[]): void {
  const seqs = new Set<number>()
  for (const event of events) {
    assert(Number.isSafeInteger(event.seq) && event.seq >= 0, "event seq must be a non-negative safe integer")
    assert(!seqs.has(event.seq), `duplicate event seq ${event.seq}`)
    seqs.add(event.seq)
  }
}

/** Small conversation assembler with the same three window operations. */
export class ConversationWindow {
  private events = new Map<number, WindowEvent>()
  private nodes = new Map<string, ConversationNode>()
  hasMore = false

  replaceWindow(entries: readonly WindowEvent[], hasMore: boolean): void {
    assertUnique(entries)
    this.events = new Map(entries.map((event) => [event.seq, deepClone(event)]))
    this.nodes.clear()
    this.hasMore = hasMore
    this.replay()
  }

  append(entry: WindowEvent): boolean {
    if (this.events.has(entry.seq)) return false
    const tail = Math.max(-1, ...this.events.keys())
    assert(entry.seq === tail + 1, `live append gap: expected ${tail + 1}, received ${entry.seq}`)
    this.events.set(entry.seq, deepClone(entry))
    this.apply(entry)
    return true
  }

  /** Older pages deduplicate and replay while preserving equal node objects. */
  prepend(entries: readonly WindowEvent[], hasMore: boolean): void {
    assertUnique(entries)
    for (const entry of entries) if (!this.events.has(entry.seq)) this.events.set(entry.seq, deepClone(entry))
    this.hasMore = hasMore
    this.replay()
  }

  snapshot(): readonly ConversationNode[] {
    return [...this.nodes.values()].sort((left, right) => left.startSeq - right.startSeq)
  }

  private replay(): void {
    const previous = this.nodes
    this.nodes = new Map()
    for (const event of [...this.events.values()].sort((left, right) => left.seq - right.seq)) this.apply(event, previous)
  }

  private apply(event: WindowEvent, previous: ReadonlyMap<string, ConversationNode> = this.nodes): void {
    if (event.type === "message") {
      const candidate: ConversationNode = { key: `message:${event.id}`, startSeq: event.seq, kind: "message", id: event.id, text: event.text ?? "", complete: true }
      this.nodes.set(candidate.key, reuse(previous.get(candidate.key), candidate))
      return
    }
    const key = `tool:${event.id}`
    const existing = this.nodes.get(key)
    if (event.type === "tool/start") {
      const candidate: ConversationNode = { key, startSeq: event.seq, kind: "tool", id: event.id, text: event.text ?? "", complete: false }
      this.nodes.set(key, reuse(previous.get(key), candidate))
      return
    }
    assert(existing !== undefined, `tool/end has no start for ${event.id}`)
    const candidate: ConversationNode = { ...existing, text: event.text ?? existing.text, complete: true }
    this.nodes.set(key, reuse(previous.get(key), candidate))
  }
}

function reuse(previous: ConversationNode | undefined, candidate: ConversationNode): ConversationNode {
  return previous !== undefined && JSON.stringify(previous) === JSON.stringify(candidate) ? previous : candidate
}

export interface SessionSummary {
  readonly sessionId: string
  readonly parentSessionId?: string
  readonly title: string
}

export interface LineageRow extends SessionSummary {
  readonly depth: number
}

/** Input order is authoritative; orphans and cycles fail soft instead of disappearing. */
export function flattenLineage(summaries: readonly SessionSummary[]): readonly LineageRow[] {
  const byId = new Map(summaries.map((summary) => [summary.sessionId, summary]))
  const children = new Map<string, SessionSummary[]>()
  const roots: SessionSummary[] = []
  for (const summary of summaries) {
    if (summary.parentSessionId !== undefined && byId.has(summary.parentSessionId)) {
      children.set(summary.parentSessionId, [...(children.get(summary.parentSessionId) ?? []), summary])
    } else roots.push(summary)
  }
  const visited = new Set<string>()
  const output: LineageRow[] = []
  const walk = (summary: SessionSummary, depth: number): void => {
    if (visited.has(summary.sessionId)) return
    visited.add(summary.sessionId)
    output.push({ ...summary, depth })
    for (const child of children.get(summary.sessionId) ?? []) walk(child, depth + 1)
  }
  for (const root of roots) walk(root, 0)
  for (const summary of summaries) if (!visited.has(summary.sessionId)) walk(summary, 0)
  return output
}

export class ToolCallTree {
  readonly maxDepth: number
  private readonly children = new Map<string, string[]>()
  private readonly depthByCall = new Map<string, number>()

  constructor(maxDepth = 256) {
    this.maxDepth = maxDepth
  }

  add(parent: string, child: string): boolean {
    if (parent === child || this.reaches(child, parent)) return false
    const childDepth = (this.depthByCall.get(parent) ?? 1) + 1
    const existingDepth = this.depthByCall.get(child) ?? 1
    const delta = childDepth - existingDepth
    const pending = [child]
    for (const current of pending) {
      const depth = (this.depthByCall.get(current) ?? 1) + delta
      if (depth > this.maxDepth) return false
      pending.push(...(this.children.get(current) ?? []))
    }
    this.children.set(parent, [...(this.children.get(parent) ?? []), child])
    for (const current of pending) {
      this.depthByCall.set(current, (this.depthByCall.get(current) ?? 1) + delta)
    }
    return true
  }

  descendants(parent: string): readonly string[] {
    const output: string[] = []
    const visit = (id: string): void => {
      for (const child of this.children.get(id) ?? []) {
        output.push(child)
        visit(child)
      }
    }
    visit(parent)
    return output
  }

  private reaches(from: string, target: string): boolean {
    const pending = [from]
    const seen = new Set(pending)
    for (const current of pending) {
      if (current === target) return true
      for (const child of this.children.get(current) ?? []) {
        if (!seen.has(child)) {
          seen.add(child)
          pending.push(child)
        }
      }
    }
    return false
  }
}

export function runProjectionLab(): Record<string, JsonValue> {
  const store = new ProjectionValueStore()
  store.seed({ asOfSeq: 10, values: { title: "baseline", usage: 10 } })
  store.apply("title", "live", 12)
  store.apply("title", "stale", 11)
  store.seed({ asOfSeq: 11, values: { usage: 11 } })
  const beforeTruncate = store.values()
  store.truncate(11)

  const window = new ConversationWindow()
  window.replaceWindow([
    { seq: 2, type: "message", id: "m2", text: "newer" },
    { seq: 3, type: "tool/start", id: "call", text: "running" },
    { seq: 4, type: "tool/end", id: "call", text: "done" },
  ], true)
  const toolBefore = window.snapshot().find((node) => node.id === "call")
  window.prepend([{ seq: 0, type: "message", id: "m0", text: "older" }, { seq: 1, type: "message", id: "m1", text: "old" }], false)
  const toolAfter = window.snapshot().find((node) => node.id === "call")

  const lineage = flattenLineage([
    { sessionId: "root", title: "root" },
    { sessionId: "child", parentSessionId: "root", title: "child" },
    { sessionId: "orphan", parentSessionId: "missing", title: "orphan" },
  ])
  const tree = new ToolCallTree(3)
  const edges = [tree.add("root", "a"), tree.add("a", "b"), tree.add("b", "root")]

  return {
    beforeTruncate,
    afterTruncate: store.values(),
    toolIdentityStable: toolBefore === toolAfter,
    nodeOrder: window.snapshot().map((node) => node.id),
    lineage: lineage.map((row) => `${row.depth}:${row.sessionId}`),
    edges,
  }
}

export function runLesson(): void {
  const facts = runProjectionLab()
  assert((facts.beforeTruncate as Record<string, JsonValue>).title === "live", "stale baseline regressed a projection")
  assert(!Object.hasOwn(facts.afterTruncate as Record<string, JsonValue>, "title"), "restart truncation kept future state")
  assert(facts.toolIdentityStable === true, "prepend replaced an unchanged node")
  printResult("advanced-02-host-projection-replay", facts)
}

const entry = process.argv[1] ?? ""
if (entry.endsWith("/02_event_projection_replay/code.ts") || entry.endsWith("\\02_event_projection_replay\\code.ts")) runLesson()
