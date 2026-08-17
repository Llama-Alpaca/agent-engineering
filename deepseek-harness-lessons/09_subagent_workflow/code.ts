import { assert, deepClone, printResult, type JsonValue, type TraceEvent } from "../common/trace.ts"

export type ChildMode = "fresh" | "fork"
export type ChildStatus = "created" | "running" | "succeeded" | "failed" | "cancelled"

export interface ChildReport {
  readonly childId: string
  readonly parentId: string
  readonly status: "succeeded" | "failed" | "cancelled"
  readonly summary: string
  readonly facts: readonly string[]
  readonly lineage: { readonly mode: ChildMode; readonly forkedEvents: number }
}

export interface ChildRecord {
  readonly id: string
  readonly parentId: string
  readonly mode: ChildMode
  readonly continuable: boolean
  readonly history: TraceEvent[]
  status: ChildStatus
  disposed: boolean
  report?: ChildReport
  error?: string
  readonly log: SessionLog
}

export interface ParentProjection {
  readonly parentId: string
  readonly childIds: readonly string[]
  readonly completed: readonly string[]
  readonly failed: readonly string[]
  readonly cancelled: readonly string[]
  readonly childProcessEvents: number
  readonly workflowWorkers: readonly string[]
  readonly workflowReports: readonly { childId: string; status: string }[]
  readonly workflowJoined: boolean
  readonly disposed: boolean
}

function primitiveData(value: Record<string, JsonValue>): Record<string, JsonValue> {
  return value
}

/** A tiny append-only log used to demonstrate parent/child event ownership. */
export class SessionLog {
  readonly events: TraceEvent[] = []
  private nextSequence = 1
  readonly sessionId: string

  constructor(sessionId: string) {
    this.sessionId = sessionId
  }

  append(type: string, data: Record<string, JsonValue> = {}): void {
    this.events.push({
      type,
      data: primitiveData({ ...data, sessionId: this.sessionId, sequence: this.nextSequence++ }),
    })
  }

  snapshot(): TraceEvent[] {
    return deepClone(this.events)
  }
}

export function replayChild(log: SessionLog): {
  status: ChildStatus
  reports: ChildReport[]
  errors: string[]
  disposed: boolean
} {
  let status: ChildStatus = "created"
  let disposed = false
  const reports: ChildReport[] = []
  const errors: string[] = []
  for (const event of log.events) {
    const data = event.data as Record<string, JsonValue> | undefined
    if (event.type === "child/started") status = "running"
    if (event.type === "child/succeeded") status = "succeeded"
    if (event.type === "child/failed") {
      status = "failed"
      errors.push(String(data?.error ?? "unknown child error"))
    }
    if (event.type === "child/cancelled") status = "cancelled"
    if (event.type === "child/report") {
      reports.push(data?.report as unknown as ChildReport)
    }
    if (event.type === "child/disposed") disposed = true
  }
  return { status, reports, errors, disposed }
}

interface ParentState {
  readonly id: string
  readonly log: SessionLog
  readonly children: Map<string, ChildRecord>
  disposed: boolean
}

export interface SpawnOptions {
  readonly mode: ChildMode
  readonly continuable?: boolean
  readonly completedPrefix?: readonly TraceEvent[]
}

export class SubagentManager {
  readonly parent: ParentState
  private nextChild = 1

  constructor(parentId: string) {
    this.parent = { id: parentId, log: new SessionLog(parentId), children: new Map(), disposed: false }
    this.parent.log.append("session/created", { owner: "parent" })
  }

  appendCompletedParentEvent(type: string, data: Record<string, JsonValue> = {}): void {
    assert(!this.parent.disposed, "parent scope is disposed")
    assert(!type.startsWith("child/") && !type.startsWith("workflow/"), "parent prefix cannot forge child events")
    this.parent.log.append(type, data)
  }

  completedParentPrefix(length: number): TraceEvent[] {
    assert(Number.isInteger(length) && length >= 0, "prefix length must be a non-negative integer")
    assert(length <= this.parent.log.events.length, "prefix exceeds parent durable log")
    return this.parent.log.snapshot().slice(0, length)
  }

  spawn(options: SpawnOptions): ChildRecord {
    assert(!this.parent.disposed, "parent scope is disposed")
    const id = `child-${String(this.nextChild++).padStart(2, "0")}`
    const history = options.mode === "fork" ? deepClone([...(options.completedPrefix ?? [])]) : []
    if (options.mode === "fork") {
      const durablePrefix = this.parent.log.snapshot().slice(0, history.length)
      assert(JSON.stringify(history) === JSON.stringify(durablePrefix), "fork prefix must match completed parent events")
    }
    const log = new SessionLog(id)
    const child: ChildRecord = {
      id,
      parentId: this.parent.id,
      mode: options.mode,
      continuable: options.continuable ?? false,
      history,
      status: "running",
      disposed: false,
      log,
    }
    log.append("session/created", { owner: "child", parentId: this.parent.id })
    if (options.mode === "fork") {
      log.append("child/forked", { parentId: this.parent.id, copiedEvents: history.length })
    }
    log.append("child/started", { mode: options.mode, continuable: child.continuable })
    this.parent.children.set(id, child)
    this.parent.log.append("child/spawned", {
      childId: id,
      mode: options.mode,
      continuable: child.continuable,
      forkedEvents: history.length,
    })
    return child
  }

  runChild(childId: string, input: string, outcome: "success" | "failure" = "success"): ChildReport {
    const child = this.getChild(childId)
    assert(child.status === "running", `child ${childId} is not running`)
    child.log.append("child/input", { input })
    if (outcome === "failure") {
      child.status = "failed"
      child.error = `worker rejected input: ${input}`
      child.log.append("child/failed", { error: child.error })
      const report: ChildReport = {
        childId,
        parentId: this.parent.id,
        status: "failed",
        summary: "child failed; no empty success was emitted",
        facts: [child.error],
        lineage: { mode: child.mode, forkedEvents: child.history.length },
      }
      child.report = report
      child.log.append("child/report", { report: report as unknown as JsonValue })
      this.parent.log.append("child/failed", { childId, error: child.error })
      this.parent.log.append("child/report", { childId, status: "failed", summary: report.summary })
      return report
    }

    child.status = "succeeded"
    const report: ChildReport = {
      childId,
      parentId: this.parent.id,
      status: "succeeded",
      summary: `reviewed ${input}`,
      facts: [`input=${input}`, `history=${child.history.length}`],
      lineage: { mode: child.mode, forkedEvents: child.history.length },
    }
    child.report = report
    child.log.append("child/report", { report: report as unknown as JsonValue })
    child.log.append("child/succeeded", { summary: report.summary })
    this.parent.log.append("child/report", { childId, status: "succeeded", summary: report.summary })
    this.parent.log.append("child/succeeded", { childId })
    return report
  }

  followUp(childId: string, input: string): ChildReport {
    const child = this.getChild(childId)
    assert(child.continuable, `child ${childId} is one-shot`)
    assert(child.status === "succeeded", `child ${childId} is not continuable from ${child.status}`)
    assert(!child.disposed, `child ${childId} is disposed`)
    child.status = "running"
    child.log.append("child/continued", { input })
    return this.runChild(childId, input, "success")
  }

  cancelChild(childId: string, reason: string): void {
    const child = this.getChild(childId)
    if (child.status !== "running") return
    child.status = "cancelled"
    child.error = reason
    child.log.append("child/cancelled", { reason })
    this.parent.log.append("child/cancelled", { childId, reason })
  }

  cancelParent(reason: string): void {
    if (this.parent.disposed) return
    this.parent.log.append("parent/cancel.requested", { reason })
    for (const child of this.parent.children.values()) {
      this.cancelChild(child.id, `parent cancelled: ${reason}`)
    }
    this.parent.log.append("parent/cancel.completed", { activeChildren: this.activeChildren().length })
  }

  disposeParent(): void {
    if (this.parent.disposed) return
    this.cancelParent("dispose")
    for (const child of this.parent.children.values()) {
      if (!child.disposed) {
        child.disposed = true
        child.log.append("child/disposed", { owner: "parent" })
        this.parent.log.append("child/disposed", { childId: child.id })
      }
    }
    this.parent.disposed = true
    this.parent.log.append("parent/disposed", { remainingChildren: this.activeChildren().length })
  }

  activeChildren(): ChildRecord[] {
    return [...this.parent.children.values()].filter((child) => child.status === "running" && !child.disposed)
  }

  getChild(childId: string): ChildRecord {
    const child = this.parent.children.get(childId)
    assert(child !== undefined, `unknown child ${childId}`)
    return child
  }

  replayParent(): ParentProjection {
    const childIds: string[] = []
    const completed: string[] = []
    const failed: string[] = []
    const cancelled: string[] = []
    const workflowWorkers: string[] = []
    const workflowReports: { childId: string; status: string }[] = []
    let childProcessEvents = 0
    let workflowJoined = false
    let disposed = false
    for (const event of this.parent.log.events) {
      const data = event.data as Record<string, JsonValue> | undefined
      if (event.type === "child/spawned") childIds.push(String(data?.childId))
      if (event.type === "child/succeeded") completed.push(String(data?.childId))
      if (event.type === "child/failed") failed.push(String(data?.childId))
      if (event.type === "child/cancelled") cancelled.push(String(data?.childId))
      if (event.type.startsWith("child/")) childProcessEvents += 1
      if (event.type === "workflow/worker-thread.started") workflowWorkers.push(String(data?.childId))
      if (event.type === "workflow/worker-thread.completed") {
        workflowReports.push({ childId: String(data?.childId), status: String(data?.status) })
      }
      if (event.type === "workflow/joined") workflowJoined = true
      if (event.type === "parent/disposed") disposed = true
    }
    return {
      parentId: this.parent.id,
      childIds,
      completed,
      failed,
      cancelled,
      childProcessEvents,
      workflowWorkers,
      workflowReports,
      workflowJoined,
      disposed,
    }
  }

  get parentEvents(): readonly TraceEvent[] {
    return this.parent.log.events
  }
}

export interface WorkflowWorker {
  readonly name: string
  readonly input: string
  readonly outcome?: "success" | "failure"
}

export interface WorkflowResult {
  readonly reports: readonly ChildReport[]
  readonly workerIds: readonly string[]
  readonly events: readonly TraceEvent[]
}

/**
 * The worker loop is intentionally deterministic. It records a worker-thread
 * start barrier, runs each isolated child, then joins reports in declaration
 * order. A real workflow can replace this scheduler with worker_threads while
 * retaining the same child/session ownership contract.
 */
export function runWorkflow(manager: SubagentManager, workers: readonly WorkflowWorker[]): WorkflowResult {
  const events: TraceEvent[] = []
  const record = (type: string, data: Record<string, JsonValue>): void => {
    events.push({ type, data })
    manager.parent.log.append(type, data)
  }
  const children = workers.map((worker) => {
    const child = manager.spawn({ mode: "fresh", continuable: false })
    record("workflow/worker-thread.started", { worker: worker.name, childId: child.id })
    return { worker, child }
  })
  record("workflow/barrier.reached", { workers: children.length })
  const reports = children.map(({ worker, child }) => {
    const report = manager.runChild(child.id, `${worker.name}:${worker.input}`, worker.outcome ?? "success")
    record("workflow/worker-thread.completed", { worker: worker.name, childId: child.id, status: report.status })
    return report
  })
  record("workflow/joined", { reports: reports.length })
  return { reports, workerIds: children.map(({ child }) => child.id), events }
}

export interface SubagentLabResult {
  readonly fresh: ChildReport
  readonly fork: ChildReport
  readonly continuation: ChildReport
  readonly failed: ChildReport
  readonly workflow: WorkflowResult
  readonly cancelledChildId: string
  readonly parentProjection: ParentProjection
  readonly childProjections: Record<string, ReturnType<typeof replayChild>>
  readonly parentAndChildLogsAreSeparate: boolean
  readonly quiescentAfterDispose: boolean
  readonly events: readonly TraceEvent[]
}

export function runSubagentLab(): SubagentLabResult {
  const manager = new SubagentManager("parent-001")
  manager.appendCompletedParentEvent("user/request", { text: "audit repository" })
  manager.appendCompletedParentEvent("assistant/plan", { steps: 2 })
  const completedPrefix = manager.completedParentPrefix(3)
  const freshChild = manager.spawn({ mode: "fresh" })
  const fresh = manager.runChild(freshChild.id, "read package manifest")

  const forkChild = manager.spawn({ mode: "fork", completedPrefix })
  const fork = manager.runChild(forkChild.id, "continue from completed prefix")

  const continuableChild = manager.spawn({ mode: "fresh", continuable: true })
  manager.runChild(continuableChild.id, "first pass")
  const continuation = manager.followUp(continuableChild.id, "follow-up: check the changed files")

  const failedChild = manager.spawn({ mode: "fresh" })
  const failed = manager.runChild(failedChild.id, "malformed task", "failure")

  const workflow = runWorkflow(manager, [
    { name: "manifest", input: "package names" },
    { name: "tests", input: "test inventory" },
    { name: "docs", input: "source anchors" },
  ])

  const pending = manager.spawn({ mode: "fresh" })
  manager.cancelParent("user closed the parent session")
  const cancelledChildId = pending.id
  manager.disposeParent()

  const childProjections: Record<string, ReturnType<typeof replayChild>> = {}
  for (const child of manager.parent.children.values()) childProjections[child.id] = replayChild(child.log)
  const parentProjection = manager.replayParent()
  const parentTypes = new Set(manager.parent.log.events.map((event) => event.type))
  const childOnlyTypes = [...manager.parent.children.values()].flatMap((child) => child.log.events.map((event) => event.type))
  const parentAndChildLogsAreSeparate = !childOnlyTypes.some((type) => type === "child/input" && parentTypes.has(type))
  return {
    fresh,
    fork,
    continuation,
    failed,
    workflow,
    cancelledChildId,
    parentProjection,
    childProjections,
    parentAndChildLogsAreSeparate,
    quiescentAfterDispose: manager.activeChildren().length === 0,
    // Workflow records were appended to the parent SessionLog above; emit the
    // durable parent stream once instead of duplicating the local scheduler trace.
    events: [...manager.parentEvents],
  }
}

export function main(): void {
  const result = runSubagentLab()
  printResult(
    "09_subagent_workflow",
    {
      fresh: result.fresh,
      fork: result.fork,
      continuation: result.continuation,
      failed: result.failed,
      workflow: { workerIds: result.workflow.workerIds, reports: result.workflow.reports },
      cancelledChildId: result.cancelledChildId,
      parentProjection: result.parentProjection,
      parentAndChildLogsAreSeparate: result.parentAndChildLogsAreSeparate,
      quiescentAfterDispose: result.quiescentAfterDispose,
    },
    result.events,
  )
}

if (process.argv[1]?.endsWith("/09_subagent_workflow/code.ts")) main()
