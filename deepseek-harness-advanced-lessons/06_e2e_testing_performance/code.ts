/**
 * L06 - upstream test lanes, offline evidence and virtual cost models.
 *
 * The locked upstream snapshot defines five repository test tiers. This
 * dependency-free lab does not execute any of them: it runs course-owned
 * invariant checks and keeps every upstream lane as an explicit skip. That
 * separation prevents an in-memory fixture from being reported as browser,
 * real-entry, coverage, snapshot or real-API evidence.
 */

import { assert, deepClone, printResult, type JsonValue, type TraceEvent } from "../../deepseek-harness-lessons/common/trace.ts"

export type OfflineCheckLayer =
  | "unit"
  | "offline-contract"
  | "offline-composition"
  | "offline-scenario"
  | "virtual-cost-model"

export type UpstreamEvidenceLane =
  | "unit"
  | "coverage-gate"
  | "real-api-e2e"
  | "keyless-snapshot"
  | "web-browser-snapshot"
  | "manual-web-perf"
  | "opt-in-web-stress"

export type RuntimeStatus = "idle" | "running" | "awaiting-approval" | "cancelled" | "completed" | "failed"

export interface RuntimeOptions {
  readonly streamDeltas?: boolean
  readonly approvalRequired?: boolean
  readonly cancelAfterSteps?: number
  readonly toolWorkUnits?: number
}

export interface RuntimeRun {
  readonly status: RuntimeStatus
  readonly output: string
  readonly events: readonly TraceEvent[]
  readonly workUnits: number
  readonly durableSignature: string
}

export interface EvidenceClaim {
  readonly layer: OfflineCheckLayer
  readonly name: string
  readonly passed: boolean
  readonly claim: string
  readonly coveredEvents: readonly string[]
  readonly limitation: string
}

export interface UpstreamEvidenceRow {
  readonly lane: UpstreamEvidenceLane
  readonly kind: "official-tier" | "opt-in-diagnostic"
  readonly command: string
  readonly status: "skip"
  readonly anchor: string
  readonly provesWhenRun: string
  readonly limitation: string
}

export interface VirtualCostRow {
  readonly name: string
  readonly calls: number
  readonly workUnits: number
  readonly eventCount: number
  readonly p50Units: number
  readonly p95Units: number
  readonly deterministic: boolean
}

export interface OfflineProjectionFixture {
  readonly runtime: {
    readonly status: RuntimeStatus
    readonly output: string
    readonly durableEventTypes: readonly string[]
  }
  readonly projection: {
    readonly permissions: readonly string[]
    readonly deltas: readonly string[]
    readonly messages: readonly string[]
  }
}

/**
 * The five documented tiers plus the two opt-in browser diagnostics. Every
 * row is skipped because this course checkout has neither the upstream
 * workspace nor its built artifacts, browser and credentials.
 */
export const UPSTREAM_EVIDENCE: readonly UpstreamEvidenceRow[] = [
  {
    lane: "unit",
    kind: "official-tier",
    command: "pnpm run test",
    status: "skip",
    anchor: "docs/testing.md; vitest.config.ts",
    provesWhenRun: "package and repository specs execute against source-plane workspace imports, including HMR cleanup contracts",
    limitation: "the course MiniHarnessRuntime is not an upstream package spec",
  },
  {
    lane: "coverage-gate",
    kind: "official-tier",
    command: "pnpm run test:coverage",
    status: "skip",
    anchor: "docs/testing.md; vitest.config.ts",
    provesWhenRun: "the configured per-file 100% gate covers in-scope packages/*/*/src files, subject to documented exclusions",
    limitation: "line coverage proves execution, not that the assembled product works",
  },
  {
    lane: "real-api-e2e",
    kind: "official-tier",
    command: "pnpm run test:e2e",
    status: "skip",
    anchor: "docs/testing.md; vitest.e2e.config.ts; .github/workflows/e2e.yml",
    provesWhenRun: "examples reach live provider APIs and verify externally observable outcomes; trusted CI selects their built lib entries",
    limitation: "local mode defaults to source and suites self-skip without provider keys; trusted CI separately preflights the DeepSeek key to prevent a false green",
  },
  {
    lane: "keyless-snapshot",
    kind: "official-tier",
    command: "pnpm run test:snapshot",
    status: "skip",
    anchor: "packages/test-support/acp-snapshot/src/suite.ts; packages/test-support/llm-replay/src/index.ts",
    provesWhenRun: "real subprocess compositions replay recorded model chunks and compare normalized protocol output plus persisted session logs",
    limitation: "replay proves the recorded transcript and assembly contract, not current provider quality",
  },
  {
    lane: "web-browser-snapshot",
    kind: "official-tier",
    command: "pnpm run test:web",
    status: "skip",
    anchor: "vitest.web.config.ts; apps/web/tests/scaffold.ts; apps/web/tests/replay-round-trip.e2e.ts",
    provesWhenRun: "the built client, real host composition, HTTP transport and Chromium produce the committed settled ARIA surface and external world state",
    limitation: "the offline projection fixture below has no browser, HTTP server, Loader composition or built client",
  },
  {
    lane: "manual-web-perf",
    kind: "opt-in-diagnostic",
    command: "pnpm run test:web:perf",
    status: "skip",
    anchor: "vitest.web.perf.config.ts; apps/web/tests/complex-history.perf.ts",
    provesWhenRun: "high-cardinality browser workloads retain their fixture sizes and emit host-specific measurements",
    limitation: "the upstream perf lane deliberately has no wall-time thresholds because host speed is not a correctness contract",
  },
  {
    lane: "opt-in-web-stress",
    kind: "opt-in-diagnostic",
    command: "pnpm run test:web:stress",
    status: "skip",
    anchor: "vitest.web-stress.config.ts; apps/web/stress-tests/reasoning-chunks.stress.ts",
    provesWhenRun: "a real Chromium surface stays responsive while consuming 100,000 reasoning chunks",
    limitation: "the current upstream stress fixture applies a 250 ms main-thread and interaction-delay budget but is not a default test:web gate",
  },
]

function event(type: string, data: Record<string, JsonValue>): TraceEvent {
  return { type, data }
}

export function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stable(record[key])}`).join(",")}}`
}

export function signature(events: readonly TraceEvent[]): string {
  return events.map((item) => `${item.type}:${stable(item.data)}`).join("|")
}

/** Course-only projection fixture. It is not an upstream protocol or browser snapshot. */
export function projectOfflineFixture(run: RuntimeRun): OfflineProjectionFixture {
  return {
    runtime: {
      status: run.status,
      output: run.output,
      durableEventTypes: run.events.filter((item) => !item.type.endsWith("/delta")).map((item) => item.type),
    },
    projection: {
      permissions: run.events.filter((item) => item.type.startsWith("permission/")).map((item) => item.type.slice("permission/".length)),
      deltas: run.events.filter((item) => item.type === "assistant/delta").map((item) => String(item.data.delta)),
      messages: run.events.filter((item) => item.type === "assistant/message").map((item) => String(item.data.content)),
    },
  }
}

export const APPROVED_OFFLINE_FIXTURE: OfflineProjectionFixture = {
  runtime: {
    status: "completed",
    output: "done:scenario",
    durableEventTypes: ["turn/start", "permission/approved", "prompt/assembled", "tool/start", "tool/result", "assistant/compose", "assistant/message", "turn/end"],
  },
  projection: {
    permissions: ["approved"],
    deltas: ["done:", "scenario"],
    messages: ["done:scenario"],
  },
}

/** Course-owned in-memory state machine used only for local invariant checks. */
export class MiniHarnessRuntime {
  readonly options: Required<RuntimeOptions>
  private status: RuntimeStatus = "idle"
  private step = 0
  private readonly events: TraceEvent[] = []

  constructor(options: RuntimeOptions = {}) {
    this.options = {
      streamDeltas: options.streamDeltas ?? true,
      approvalRequired: options.approvalRequired ?? false,
      cancelAfterSteps: options.cancelAfterSteps ?? -1,
      toolWorkUnits: options.toolWorkUnits ?? 3,
    }
  }

  run(input: string, approve = false): RuntimeRun {
    assert(this.status === "idle", "runtime instances are single-use")
    this.status = "running"
    this.push("turn/start", { input })
    if (this.options.approvalRequired && !approve) {
      this.status = "awaiting-approval"
      this.push("permission/required", { tool: "workspace.write" })
      return this.finish(0, "")
    }
    if (this.options.approvalRequired) this.push("permission/approved", { tool: "workspace.write" })
    this.advanceStep("prompt/assembled")
    if (this.cancelled()) return this.finish(0, "")
    this.advanceStep("tool/start")
    const work = this.options.toolWorkUnits
    if (this.cancelled()) return this.finish(work, "")
    this.push("tool/result", { ok: true, workUnits: work })
    this.advanceStep("assistant/compose")
    if (this.cancelled()) return this.finish(work, "")
    const output = `done:${input}`
    if (this.options.streamDeltas) {
      for (const delta of output.split(":")) this.push("assistant/delta", { delta: `${delta}${delta === "done" ? ":" : ""}` })
    }
    this.push("assistant/message", { content: output })
    this.status = "completed"
    this.push("turn/end", { status: this.status })
    return this.finish(work, output)
  }

  private advanceStep(type: string): void {
    this.step += 1
    this.push(type, { step: this.step })
  }

  private cancelled(): boolean {
    if (this.options.cancelAfterSteps < 0 || this.step < this.options.cancelAfterSteps) return false
    this.status = "cancelled"
    this.push("turn/cancelled", { step: this.step })
    return true
  }

  private push(type: string, data: Record<string, JsonValue>): void {
    this.events.push(event(type, data))
  }

  private finish(workUnits: number, output: string): RuntimeRun {
    if (this.status === "running") this.status = "failed"
    return {
      status: this.status,
      output,
      events: deepClone(this.events),
      workUnits,
      durableSignature: signature(this.events.filter((item) => !item.type.endsWith("/delta"))),
    }
  }
}

export function runUnitChecks(): readonly EvidenceClaim[] {
  const run = new MiniHarnessRuntime({ streamDeltas: false }).run("unit")
  const eventNames = run.events.map((item) => item.type)
  return [
    {
      layer: "unit",
      name: "terminal-state",
      passed: run.status === "completed",
      claim: "the course state machine reaches completed",
      coveredEvents: ["turn/end"],
      limitation: "does not execute an upstream package or Loader composition",
    },
    {
      layer: "unit",
      name: "durable-order",
      passed: eventNames.indexOf("turn/start") < eventNames.indexOf("assistant/message"),
      claim: "the course trace preserves start-before-message order",
      coveredEvents: ["turn/start", "assistant/message"],
      limitation: "does not prove upstream Session persistence or transport ordering",
    },
  ]
}

export function runOfflineContractChecks(): readonly EvidenceClaim[] {
  const normal = new MiniHarnessRuntime({ streamDeltas: true }).run("contract")
  const blocked = new MiniHarnessRuntime({ approvalRequired: true }).run("contract")
  const stableSignature = normal.durableSignature === new MiniHarnessRuntime({ streamDeltas: true }).run("contract").durableSignature
  return [
    {
      layer: "offline-contract",
      name: "event-signature",
      passed: stableSignature,
      claim: "the course fixture has a repeatable durable signature",
      coveredEvents: ["turn/start", "assistant/message", "turn/end"],
      limitation: "upstream snapshots compare normalized JSON-RPC and persisted JSONL, not this synthetic signature",
    },
    {
      layer: "offline-contract",
      name: "approval-boundary",
      passed: blocked.status === "awaiting-approval" && !blocked.events.some((item) => item.type === "tool/start"),
      claim: "the course fixture pauses before tool start when approval is absent",
      coveredEvents: ["permission/required", "tool/start"],
      limitation: "does not exercise upstream ApprovalService, permission UI or sandbox",
    },
  ]
}

export function runOfflineCompositionChecks(): readonly EvidenceClaim[] {
  const run = new MiniHarnessRuntime({ streamDeltas: true }).run("composition")
  const names = run.events.map((item) => item.type)
  const contiguous = names.indexOf("tool/start") + 1 === names.indexOf("tool/result")
  return [{
    layer: "offline-composition",
    name: "tool-to-assistant",
    passed: contiguous && names.indexOf("tool/result") < names.indexOf("assistant/message"),
    claim: "the course-owned components commit a tool result before the assistant message",
    coveredEvents: ["tool/start", "tool/result", "assistant/message"],
    limitation: "hand-constructed components are not the real Loader or published entry path",
  }]
}

export function runOfflineScenarioChecks(): readonly EvidenceClaim[] {
  const approved = new MiniHarnessRuntime({ approvalRequired: true }).run("scenario", true)
  const cancelled = new MiniHarnessRuntime({ cancelAfterSteps: 1 }).run("scenario")
  return [
    {
      layer: "offline-scenario",
      name: "approved-path",
      passed: approved.status === "completed" && approved.events.some((item) => item.type === "permission/approved"),
      claim: "the course scenario closes its approved path",
      coveredEvents: ["permission/approved", "turn/end"],
      limitation: "no process, protocol, HTTP server or browser entry point was used",
    },
    {
      layer: "offline-scenario",
      name: "projection-fixture",
      passed: stable(projectOfflineFixture(approved)) === stable(APPROVED_OFFLINE_FIXTURE),
      claim: "the course runtime and projection fixture stay synchronized",
      coveredEvents: ["assistant/delta", "assistant/message", "permission/approved"],
      limitation: "this object is neither an ACP stdout/session snapshot nor a Web ARIA golden",
    },
    {
      layer: "offline-scenario",
      name: "cancel-path",
      passed: cancelled.status === "cancelled" && !cancelled.events.some((item) => item.type === "assistant/message"),
      claim: "the course scenario prevents assistant commit after cancellation",
      coveredEvents: ["turn/cancelled", "assistant/message"],
      limitation: "does not exercise transport close, subprocess teardown or browser presentation",
    },
  ]
}

function percentileUnits(values: readonly number[], fraction: number): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))] ?? 0
}

/** Count synthetic work only. These units are not milliseconds or a benchmark. */
export function modelWorkloadCost(name: string, options: RuntimeOptions, calls = 32): VirtualCostRow {
  const samples: number[] = []
  let eventCount = 0
  let workUnits = 0
  let firstSignature = ""
  let deterministic = true
  for (let index = 0; index < calls; index += 1) {
    const run = new MiniHarnessRuntime(options).run(`cost-${index}`)
    const cost = run.workUnits + run.events.length
    samples.push(cost)
    eventCount += run.events.length
    workUnits += run.workUnits
    const normalized = run.durableSignature.replaceAll(`cost-${index}`, "cost-n")
    if (index === 0) firstSignature = normalized
    else deterministic = deterministic && normalized === firstSignature
  }
  return {
    name,
    calls,
    workUnits,
    eventCount,
    p50Units: percentileUnits(samples, 0.5),
    p95Units: percentileUnits(samples, 0.95),
    deterministic,
  }
}

export function runVirtualCostChecks(): readonly EvidenceClaim[] {
  const row = modelWorkloadCost("virtual-cost", { streamDeltas: true }, 64)
  return [{
    layer: "virtual-cost-model",
    name: "repeatable-work-units",
    passed: row.deterministic && row.p95Units >= row.p50Units && row.calls === 64,
    claim: "a fixed course workload has a repeatable synthetic cost distribution",
    coveredEvents: ["tool/result", "turn/end"],
    limitation: "work units measure no elapsed time, browser responsiveness, throughput, memory or cancellation latency",
  }]
}

export interface LayeredReport {
  readonly courseClaims: readonly EvidenceClaim[]
  readonly virtualCosts: readonly VirtualCostRow[]
  readonly upstreamEvidence: readonly UpstreamEvidenceRow[]
  readonly allCourseChecksPassed: boolean
  readonly unclaimedEvents: readonly string[]
}

export function runLayeredReport(): LayeredReport {
  const courseClaims = [
    ...runUnitChecks(),
    ...runOfflineContractChecks(),
    ...runOfflineCompositionChecks(),
    ...runOfflineScenarioChecks(),
    ...runVirtualCostChecks(),
  ]
  const virtualCosts = [
    modelWorkloadCost("with-delta", { streamDeltas: true, toolWorkUnits: 3 }),
    modelWorkloadCost("without-delta", { streamDeltas: false, toolWorkUnits: 3 }),
  ]
  const covered = new Set(courseClaims.flatMap((claim) => claim.coveredEvents))
  const required = ["turn/start", "tool/result", "assistant/message", "turn/end", "turn/cancelled"]
  return {
    courseClaims,
    virtualCosts,
    upstreamEvidence: deepClone(UPSTREAM_EVIDENCE),
    allCourseChecksPassed: courseClaims.every((claim) => claim.passed),
    unclaimedEvents: required.filter((name) => !covered.has(name)),
  }
}

export function runLesson(): void {
  const report = runLayeredReport()
  assert(report.allCourseChecksPassed, "all course-owned evidence claims must pass")
  assert(report.unclaimedEvents.length === 0, `missing course evidence for ${report.unclaimedEvents.join(",")}`)
  assert(report.courseClaims.every((claim) => claim.limitation.length > 0), "every course claim needs a limitation")
  assert(report.upstreamEvidence.every((row) => row.status === "skip"), "offline course must not claim an upstream lane passed")
  printResult("advanced-06-e2e-testing-performance", {
    courseClaims: report.courseClaims.map((claim) => `${claim.layer}:${claim.name}`),
    virtualCost: report.virtualCosts.map((row) => ({ name: row.name, p50Units: row.p50Units, p95Units: row.p95Units, deterministic: row.deterministic })),
    upstreamEvidence: report.upstreamEvidence.map((row) => `${row.lane}:${row.status}`),
  })
}

const entry = process.argv[1] ?? ""
if (entry.endsWith("/06_e2e_testing_performance/code.ts") || entry.endsWith("\\06_e2e_testing_performance\\code.ts")) runLesson()
