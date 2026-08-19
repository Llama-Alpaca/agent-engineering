/**
 * L04 - process-local jobs, completion delivery, and worker-thread workflows.
 *
 * This models the current upstream boundary rather than pretending jobs are
 * durable: records live in memory, kill stays `stopping` until the producer's
 * `done` settles, access is fenced by owner session id, and wakeup delivery has
 * a consecutive budget. Workflow values must cross a plain-JSON realm seam.
 */

import { assert, printResult, type JsonValue } from "../../deepseek-harness-lessons/common/trace.ts"

export type JobStatus = "running" | "stopping" | "completed" | "killed" | "failed"

export interface Owner {
  readonly agentId: string
  readonly sessionId: string
  readonly instance: number
}

export interface JobOutcome {
  readonly status: "completed" | "killed" | "failed"
  readonly output?: string
  readonly detail?: string
}

export interface JobSnapshot {
  readonly id: string
  readonly ownerSession?: string
  readonly status: JobStatus
  readonly label: string
  readonly reported: boolean
  readonly output?: string
}

export class ManualProducer {
  readonly cancelReasons: (string | undefined)[] = []
  cancelThrows = false
  private listeners: ((outcome: JobOutcome) => void)[] = []
  private outcome: JobOutcome | undefined

  cancel(reason?: string): void {
    if (this.cancelThrows) throw new Error("producer cancel failed")
    this.cancelReasons.push(reason)
  }

  onDone(listener: (outcome: JobOutcome) => void): void {
    if (this.outcome === undefined) this.listeners.push(listener)
    else listener(this.outcome)
  }

  settle(outcome: JobOutcome): void {
    if (this.outcome !== undefined) return
    this.outcome = { ...outcome }
    const listeners = this.listeners
    this.listeners = []
    for (const listener of listeners) listener(this.outcome)
  }
}

interface TrackedJob {
  readonly id: string
  readonly owner?: Owner
  readonly producer: ManualProducer
  readonly label: string
  status: JobStatus
  reported: boolean
  output?: string
}

export type JobDoneListener = (snapshot: JobSnapshot, owner: Owner | undefined) => void

/** A deliberately process-local registry with first-wins settlement. */
export class LocalJobRegistry {
  private readonly jobs = new Map<string, TrackedJob>()
  private readonly controllers = new Set<string>()
  private readonly listeners = new Set<JobDoneListener>()
  private readonly activeByOwner = new Map<string, number>()
  private nextId = 1
  readonly maxConcurrentJobsPerOwner: number

  constructor(maxConcurrentJobsPerOwner = 2) {
    this.maxConcurrentJobsPerOwner = maxConcurrentJobsPerOwner
  }

  attachController(ownerSession = "*"): () => void {
    this.controllers.add(ownerSession)
    return () => this.controllers.delete(ownerSession)
  }

  onJobDone(listener: JobDoneListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  start(options: { readonly owner?: Owner; readonly label: string; readonly producer: ManualProducer }): string {
    const bucket = options.owner?.sessionId ?? "<unowned>"
    assert(this.controllers.has("*") || this.controllers.has(bucket), "no job controller serves this owner")
    assert((this.activeByOwner.get(bucket) ?? 0) < this.maxConcurrentJobsPerOwner, `background job limit reached for this owner (limit: ${this.maxConcurrentJobsPerOwner})`)
    const id = `job-${this.nextId++}`
    const record: TrackedJob = { id, owner: options.owner, producer: options.producer, label: options.label, status: "running", reported: false }
    this.jobs.set(id, record)
    this.activeByOwner.set(bucket, (this.activeByOwner.get(bucket) ?? 0) + 1)
    options.producer.onDone((outcome) => this.settle(record, outcome))
    return id
  }

  list(caller?: Owner): readonly JobSnapshot[] {
    return [...this.jobs.values()].filter((record) => this.authorized(record, caller, false)).map((record) => this.snapshot(record))
  }

  get(id: string, caller?: Owner): JobSnapshot {
    return this.snapshot(this.require(id, caller))
  }

  read(id: string, caller?: Owner): JobSnapshot {
    const record = this.require(id, caller)
    if (terminal(record.status)) record.reported = true
    return this.snapshot(record)
  }

  /** cancel() must succeed before the stopping transition commits. */
  kill(id: string, caller?: Owner, reason?: string): "requested" | "already-finished" {
    const record = this.require(id, caller)
    if (terminal(record.status)) {
      record.reported = true
      return "already-finished"
    }
    record.producer.cancel(reason)
    record.status = "stopping"
    record.reported = true
    return "requested"
  }

  activeCount(owner?: Owner): number {
    return this.activeByOwner.get(owner?.sessionId ?? "<unowned>") ?? 0
  }

  private settle(record: TrackedJob, outcome: JobOutcome): void {
    if (terminal(record.status)) return
    record.status = outcome.status
    record.output = outcome.output
    const bucket = record.owner?.sessionId ?? "<unowned>"
    this.activeByOwner.set(bucket, Math.max(0, (this.activeByOwner.get(bucket) ?? 1) - 1))
    const snapshot = this.snapshot(record)
    for (const listener of this.listeners) listener(snapshot, record.owner)
  }

  private require(id: string, caller?: Owner): TrackedJob {
    const record = this.jobs.get(id)
    assert(record !== undefined && this.authorized(record, caller, true), `unknown or foreign job ${id}`)
    return record
  }

  private authorized(record: TrackedJob, caller: Owner | undefined, strict: boolean): boolean {
    if (record.owner === undefined) return true
    if (caller?.sessionId === record.owner.sessionId) return true
    return strict ? false : false
  }

  private snapshot(record: TrackedJob): JobSnapshot {
    return {
      id: record.id,
      ...(record.owner === undefined ? {} : { ownerSession: record.owner.sessionId }),
      status: record.status,
      label: record.label,
      reported: record.reported,
      ...(record.output === undefined ? {} : { output: record.output }),
    }
  }
}

function terminal(status: JobStatus): boolean {
  return status === "completed" || status === "killed" || status === "failed"
}

export interface CompletionNotice {
  readonly jobId: string
  readonly delivery: "step" | "wakeup" | "quiet"
  readonly text: string
}

export class CompletionReporter {
  readonly notices: CompletionNotice[] = []
  private readonly busy = new Set<string>()
  private readonly consecutiveWakes = new Map<string, number>()
  readonly completionDelivery: "quiet" | "wakeup"
  readonly maxConsecutiveWakes: number
  readonly outputLimitBytes: number

  constructor(options: { readonly completionDelivery: "quiet" | "wakeup"; readonly maxConsecutiveWakes: number; readonly outputLimitBytes: number }) {
    this.completionDelivery = options.completionDelivery
    this.maxConsecutiveWakes = options.maxConsecutiveWakes
    this.outputLimitBytes = options.outputLimitBytes
  }

  setBusy(sessionId: string, busy: boolean): void {
    if (busy) this.busy.add(sessionId)
    else this.busy.delete(sessionId)
  }

  resetWakeBudget(sessionId: string): void {
    this.consecutiveWakes.set(sessionId, 0)
  }

  report(snapshot: JobSnapshot, owner?: Owner): void {
    if (snapshot.reported || owner === undefined) return
    let delivery: CompletionNotice["delivery"] = "quiet"
    if (this.busy.has(owner.sessionId)) delivery = "step"
    else if (this.completionDelivery === "wakeup" && (this.consecutiveWakes.get(owner.sessionId) ?? 0) < this.maxConsecutiveWakes) {
      delivery = "wakeup"
      this.consecutiveWakes.set(owner.sessionId, (this.consecutiveWakes.get(owner.sessionId) ?? 0) + 1)
    }
    this.notices.push({ jobId: snapshot.id, delivery, text: utf8Cap(`${snapshot.label}: ${snapshot.output ?? snapshot.status}`, this.outputLimitBytes) })
  }
}

export function utf8Cap(value: string, maxBytes: number): string {
  assert(Number.isSafeInteger(maxBytes) && maxBytes >= 0, "byte limit must be non-negative")
  const bytes = Buffer.from(value)
  if (bytes.byteLength <= maxBytes) return value
  let end = maxBytes
  while (end > 0 && (bytes[end] ?? 0) >> 6 === 0b10) end -= 1
  return bytes.subarray(0, end).toString("utf8")
}

export class WorkflowError extends Error {
  readonly fatal: boolean

  constructor(message: string, fatal = false) {
    super(message)
    this.name = "WorkflowError"
    this.fatal = fatal
  }
}

export class MaterializeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "MaterializeError"
  }
}

export interface WorkflowEvent {
  readonly type: "workflow/start" | "workflow/phase" | "workflow/log" | "workflow/agent-start" | "workflow/agent-end" | "workflow/end"
  readonly data: Record<string, JsonValue>
}

function plainJson(value: unknown, path = "$", seen = new WeakSet<object>()): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value !== "object") throw new MaterializeError(`workflow value at ${path} is not plain JSON`)
  if (seen.has(value)) throw new MaterializeError(`workflow value at ${path} is circular`)
  seen.add(value)
  if (Array.isArray(value)) return value.map((item, index) => plainJson(item, `${path}[${index}]`, seen))
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) throw new MaterializeError(`workflow value at ${path} has an exotic prototype`)
  const output: Record<string, JsonValue> = {}
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) output[key] = plainJson(item, `${path}.${key}`, seen)
  return output
}

export class WorkflowRuntime {
  readonly events: WorkflowEvent[] = []
  readonly maxAgents: number
  private agents = 0
  private cancelled = false

  constructor(maxAgents = 4) {
    this.maxAgents = maxAgents
  }

  cancel(): void {
    this.cancelled = true
  }

  start(): void {
    this.events.push({ type: "workflow/start", data: {} })
  }

  phase(name: string): void {
    this.events.push({ type: "workflow/phase", data: { name } })
  }

  log(message: string): void {
    this.events.push({ type: "workflow/log", data: { message } })
  }

  agent(id: string, action: () => unknown): JsonValue | null {
    assert(this.agents < this.maxAgents, "workflow agent cap reached")
    this.agents += 1
    this.events.push({ type: "workflow/agent-start", data: { id } })
    let reason: "completed" | "failed" | "cancelled" = "completed"
    try {
      if (this.cancelled) {
        reason = "cancelled"
        return null
      }
      try {
        return plainJson(action())
      } catch (error) {
        reason = "failed"
        if (error instanceof MaterializeError || (error instanceof WorkflowError && error.fatal)) throw error
        return null
      }
    } finally {
      this.events.push({ type: "workflow/agent-end", data: { id, reason } })
    }
  }

  end(status: "completed" | "cancelled" | "failed"): void {
    this.events.push({ type: "workflow/end", data: { status } })
  }
}

export function runJobsWorkflowLab(): Record<string, JsonValue> {
  const alice: Owner = { agentId: "alice", sessionId: "session-a", instance: 1 }
  const sameSessionReplacement: Owner = { agentId: "alice-new", sessionId: "session-a", instance: 2 }
  const bob: Owner = { agentId: "bob", sessionId: "session-b", instance: 1 }
  const registry = new LocalJobRegistry(1)
  registry.attachController("*")
  const reporter = new CompletionReporter({ completionDelivery: "wakeup", maxConsecutiveWakes: 1, outputLimitBytes: 24 })
  registry.onJobDone((snapshot, owner) => reporter.report(snapshot, owner))
  const first = new ManualProducer()
  const firstId = registry.start({ owner: alice, label: "compile", producer: first })
  registry.kill(firstId, alice, "no longer needed")
  let capacityHeld = false
  try {
    registry.start({ owner: alice, label: "second", producer: new ManualProducer() })
  } catch {
    capacityHeld = true
  }
  first.settle({ status: "killed", output: "cancelled" })

  const second = new ManualProducer()
  const secondId = registry.start({ owner: alice, label: "test", producer: second })
  second.settle({ status: "completed", output: "通过-通过-通过-通过" })
  const third = new ManualProducer()
  const thirdId = registry.start({ owner: alice, label: "lint", producer: third })
  third.settle({ status: "completed", output: "ok" })

  const workflow = new WorkflowRuntime(3)
  workflow.start()
  workflow.phase("research")
  const good = workflow.agent("good", () => ({ answer: 42 }))
  const ordinaryFailure = workflow.agent("ordinary", () => { throw new Error("model failed") })
  workflow.end("completed")

  return {
    capacityHeldUntilDone: capacityHeld,
    replacementCanRead: registry.get(secondId, sameSessionReplacement).status,
    bobCanRead: (() => { try { registry.get(secondId, bob); return true } catch { return false } })(),
    deliveries: reporter.notices.map((notice) => notice.delivery),
    cappedBytes: Buffer.byteLength(reporter.notices[0]?.text ?? ""),
    processRestartJobs: new LocalJobRegistry().list(alice).length,
    workflowGood: good,
    workflowOrdinaryFailure: ordinaryFailure,
    workflowAgentPairs: workflow.events.filter((event) => event.type === "workflow/agent-start" || event.type === "workflow/agent-end").map((event) => `${event.type}:${event.data.id}`),
    settledIds: [firstId, secondId, thirdId],
  }
}

export function runLesson(): void {
  const facts = runJobsWorkflowLab()
  assert(facts.capacityHeldUntilDone === true, "stopping released capacity early")
  assert(facts.bobCanRead === false, "owner fence leaked a job")
  assert(JSON.stringify(facts.deliveries) === JSON.stringify(["wakeup", "quiet"]), "wakeup budget failed")
  assert(facts.processRestartJobs === 0, "course model falsely persisted local jobs")
  printResult("advanced-04-jobs-workflow-boundary", facts)
}

const entry = process.argv[1] ?? ""
if (entry.endsWith("/04_jobs_recovery/code.ts") || entry.endsWith("\\04_jobs_recovery\\code.ts")) runLesson()
