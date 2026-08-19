/**
 * L07 - upstream evolution audit and migration capstone.
 *
 * A source-reading course goes stale unless its evidence is pinned.  This lab
 * compares two deterministic source manifests, classifies drift, checks API
 * compatibility and builds a migration plan.  It never fetches GitHub; real
 * SHAs and file digests are inputs supplied by an explicit update workflow.
 */

import { assert, deepClone, printResult, type JsonValue, type TraceEvent } from "../../deepseek-harness-lessons/common/trace.ts"

export type ChangeKind = "added" | "removed" | "modified" | "moved" | "unchanged"
export type Severity = "info" | "review" | "breaking"

export interface SourceEntry {
  readonly path: string
  readonly digest: string
  readonly symbols: readonly string[]
  readonly owner: "protocol" | "runtime" | "session" | "tool" | "product" | "test" | "build"
}

export interface SourceManifest {
  readonly project: "deepseek-harness"
  readonly commit: string
  readonly version: string
  readonly generatedAt: string
  readonly entries: readonly SourceEntry[]
  readonly contracts: readonly PublicContract[]
}

export interface PublicContract {
  readonly name: string
  readonly kind: "event" | "method" | "schema" | "entrypoint"
  readonly signature: string
  readonly stability: "experimental" | "documented"
}

export interface SourceChange {
  readonly kind: ChangeKind
  readonly before?: SourceEntry
  readonly after?: SourceEntry
  readonly severity: Severity
  readonly reason: string
}

export interface ContractChange {
  readonly name: string
  readonly kind: ChangeKind
  readonly severity: Severity
  readonly before?: PublicContract
  readonly after?: PublicContract
  readonly reason: string
}

export interface MigrationStep {
  readonly order: number
  readonly action: "update-anchor" | "rewrite-lab" | "add-test" | "manual-review"
  readonly target: string
  readonly reason: string
}

export type CompatibilityStatus = "compatible" | "retest" | "incompatible"

export interface CompatibilityTarget {
  readonly name: string
  readonly contracts: readonly string[]
}

export interface CompatibilityRow {
  readonly target: string
  readonly status: CompatibilityStatus
  readonly affectedContracts: readonly string[]
  readonly reason: string
}

export interface DriftReport {
  readonly from: string
  readonly to: string
  readonly sourceChanges: readonly SourceChange[]
  readonly contractChanges: readonly ContractChange[]
  readonly compatibility: readonly CompatibilityRow[]
  readonly migration: readonly MigrationStep[]
  readonly blockers: readonly string[]
  readonly evidence: readonly TraceEvent[]
}

function byPath(entries: readonly SourceEntry[]): Map<string, SourceEntry> {
  return new Map(entries.map((entry) => [entry.path, entry]))
}

function byContract(entries: readonly PublicContract[]): Map<string, PublicContract> {
  return new Map(entries.map((entry) => [`${entry.kind}:${entry.name}`, entry]))
}

function sameSymbols(a: readonly string[], b: readonly string[]): boolean {
  return [...a].sort().join("\0") === [...b].sort().join("\0")
}

function entrySeverity(before: SourceEntry | undefined, after: SourceEntry | undefined): Severity {
  if (!before || !after) return before?.owner === "runtime" || before?.owner === "session" ? "breaking" : "review"
  if (!sameSymbols(before.symbols, after.symbols)) return before.owner === "runtime" || before.owner === "session" ? "breaking" : "review"
  return "review"
}

/** Detect exact moves first, then classify path-local drift. */
export function compareSources(before: SourceManifest, after: SourceManifest): readonly SourceChange[] {
  assert(before.project === after.project, "cannot compare different projects")
  const oldByPath = byPath(before.entries)
  const newByPath = byPath(after.entries)
  const consumedNew = new Set<string>()
  const changes: SourceChange[] = []

  for (const oldEntry of [...before.entries].sort((a, b) => a.path.localeCompare(b.path))) {
    const direct = newByPath.get(oldEntry.path)
    if (direct) {
      consumedNew.add(direct.path)
      if (direct.digest === oldEntry.digest && sameSymbols(direct.symbols, oldEntry.symbols)) {
        changes.push({ kind: "unchanged", before: deepClone(oldEntry), after: deepClone(direct), severity: "info", reason: "path and evidence digest match" })
      } else {
        changes.push({ kind: "modified", before: deepClone(oldEntry), after: deepClone(direct), severity: entrySeverity(oldEntry, direct), reason: "digest or symbol inventory changed" })
      }
      continue
    }
    const moved = after.entries.find((candidate) => !consumedNew.has(candidate.path) && candidate.digest === oldEntry.digest && sameSymbols(candidate.symbols, oldEntry.symbols))
    if (moved) {
      consumedNew.add(moved.path)
      changes.push({ kind: "moved", before: deepClone(oldEntry), after: deepClone(moved), severity: "review", reason: "same evidence moved to a new path" })
    } else {
      changes.push({ kind: "removed", before: deepClone(oldEntry), severity: entrySeverity(oldEntry, undefined), reason: "pinned source anchor no longer exists" })
    }
  }
  for (const entry of [...after.entries].sort((a, b) => a.path.localeCompare(b.path))) {
    if (consumedNew.has(entry.path) || oldByPath.has(entry.path)) continue
    changes.push({ kind: "added", after: deepClone(entry), severity: "review", reason: "new source area requires ownership review" })
  }
  return changes
}

export function compareContracts(before: SourceManifest, after: SourceManifest): readonly ContractChange[] {
  const oldContracts = byContract(before.contracts)
  const newContracts = byContract(after.contracts)
  const keys = [...new Set([...oldContracts.keys(), ...newContracts.keys()])].sort()
  return keys.map((key) => {
    const oldContract = oldContracts.get(key)
    const newContract = newContracts.get(key)
    if (!oldContract) return { name: key, kind: "added", severity: "info", after: deepClone(newContract!), reason: "new public contract" }
    if (!newContract) return { name: key, kind: "removed", severity: oldContract.stability === "documented" ? "breaking" : "review", before: deepClone(oldContract), reason: "public contract removed" }
    if (oldContract.signature === newContract.signature) return { name: key, kind: "unchanged", severity: "info", before: deepClone(oldContract), after: deepClone(newContract), reason: "signature unchanged" }
    return { name: key, kind: "modified", severity: oldContract.stability === "documented" ? "breaking" : "review", before: deepClone(oldContract), after: deepClone(newContract), reason: "public signature changed" }
  })
}

export function buildMigration(sourceChanges: readonly SourceChange[], contractChanges: readonly ContractChange[]): readonly MigrationStep[] {
  const steps: Omit<MigrationStep, "order">[] = []
  for (const change of sourceChanges) {
    if (change.kind === "unchanged") continue
    const target = change.after?.path ?? change.before?.path ?? "unknown"
    const action: MigrationStep["action"] = change.kind === "moved" ? "update-anchor" : change.severity === "breaking" ? "rewrite-lab" : "manual-review"
    steps.push({ action, target, reason: change.reason })
  }
  for (const change of contractChanges) {
    if (change.kind === "unchanged" || change.kind === "added") continue
    steps.push({ action: "add-test", target: change.name, reason: change.reason })
  }
  const priority: Readonly<Record<MigrationStep["action"], number>> = {
    "rewrite-lab": 0,
    "update-anchor": 1,
    "manual-review": 2,
    "add-test": 3,
  }
  return steps
    .sort((a, b) => priority[a.action] - priority[b.action] || a.target.localeCompare(b.target))
    .map((step, index) => ({ ...step, order: index + 1 }))
}

export function buildCompatibilityMatrix(
  contractChanges: readonly ContractChange[],
  targets: readonly CompatibilityTarget[],
): readonly CompatibilityRow[] {
  const changes = new Map(contractChanges.map((change) => [change.name, change]))
  return [...targets].sort((a, b) => a.name.localeCompare(b.name)).map((target) => {
    const affected = target.contracts.map((name) => changes.get(name)).filter((change): change is ContractChange => change !== undefined && change.kind !== "unchanged")
    const breaking = affected.filter((change) => change.severity === "breaking")
    const review = affected.filter((change) => change.severity === "review")
    const status: CompatibilityStatus = breaking.length > 0 ? "incompatible" : review.length > 0 ? "retest" : "compatible"
    const reason = status === "incompatible"
      ? "documented dependency changed"
      : status === "retest"
        ? "experimental dependency changed"
        : "declared dependencies are unchanged"
    return { target: target.name, status, affectedContracts: affected.map((change) => change.name).sort(), reason }
  })
}

export const DEFAULT_COMPATIBILITY_TARGETS: readonly CompatibilityTarget[] = [
  { name: "acp-client", contracts: ["schema:acp/initialize.promptCapabilities.image"] },
  { name: "job-plugin", contracts: [] },
  { name: "sdk-facade", contracts: ["schema:sdk/session-prompt.result"] },
  { name: "web-projection", contracts: [] },
]

export function validateManifest(manifest: SourceManifest): readonly string[] {
  const failures: string[] = []
  if (!/^[0-9a-f]{7,40}$/.test(manifest.commit)) failures.push("commit must be a 7-40 character lowercase git SHA")
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(manifest.generatedAt)) failures.push("generatedAt must be UTC without milliseconds")
  const paths = new Set<string>()
  for (const entry of manifest.entries) {
    if (paths.has(entry.path)) failures.push(`duplicate source path: ${entry.path}`)
    paths.add(entry.path)
    if (entry.path.startsWith("/") || entry.path.split("/").includes("..")) failures.push(`unsafe source path: ${entry.path}`)
    if (entry.digest.length < 4) failures.push(`digest too short: ${entry.path}`)
  }
  return failures
}

export function auditUpgrade(before: SourceManifest, after: SourceManifest): DriftReport {
  const validation = [...validateManifest(before).map((item) => `before: ${item}`), ...validateManifest(after).map((item) => `after: ${item}`)]
  const sourceChanges = compareSources(before, after)
  const contractChanges = compareContracts(before, after)
  const compatibility = buildCompatibilityMatrix(contractChanges, DEFAULT_COMPATIBILITY_TARGETS)
  const migration = buildMigration(sourceChanges, contractChanges)
  const blockers = [
    ...validation,
    ...contractChanges.filter((change) => change.severity === "breaking").map((change) => `breaking contract: ${change.name}`),
    ...sourceChanges.filter((change) => change.severity === "breaking").map((change) => `breaking source anchor: ${change.before?.path ?? change.after?.path}`),
  ]
  const evidence: TraceEvent[] = [
    { type: "upgrade/compared", data: { from: before.commit, to: after.commit } },
    { type: "upgrade/source-summary", data: summarizeKinds(sourceChanges) },
    { type: "upgrade/contract-summary", data: summarizeKinds(contractChanges) },
    { type: "upgrade/compatibility", data: { incompatible: compatibility.filter((row) => row.status === "incompatible").length, retest: compatibility.filter((row) => row.status === "retest").length } },
    { type: "upgrade/gate", data: { blocked: blockers.length > 0, blockerCount: blockers.length } },
  ]
  return { from: before.commit, to: after.commit, sourceChanges, contractChanges, compatibility, migration, blockers, evidence }
}

function summarizeKinds(changes: readonly { readonly kind: ChangeKind }[]): Record<string, JsonValue> {
  const summary: Record<string, JsonValue> = { added: 0, removed: 0, modified: 0, moved: 0, unchanged: 0 }
  for (const change of changes) summary[change.kind] = Number(summary[change.kind]) + 1
  return summary
}

export function buildFixture(): { readonly before: SourceManifest; readonly after: SourceManifest } {
  const before: SourceManifest = {
    project: "deepseek-harness",
    commit: "47f943859bef60e4160492346772ded9b24f765a",
    version: "0.1.0-rc.5",
    generatedAt: "2026-08-19T00:00:00Z",
    entries: [
      { path: "package.json", digest: "81cedbbb420e824b6d41312c5a7abb8720861e54", symbols: ["version=0.1.0-rc.5"], owner: "build" },
      { path: "packages/core/session/src/index.ts", digest: "2d82a88623cf8b8d381f9ba905ba2e7088cbfe12", symbols: ["Session", "SessionStore"], owner: "session" },
      { path: "packages/acp/acp/src/index.ts", digest: "d595c69e692f57dd08d94ec8e906632acb80079c", symbols: ["apply", "settlePrompt", "acpPromptToText"], owner: "protocol" },
      { path: "patches/node-pty@1.1.0.patch", digest: "56892a3d583108f3dae18b0a4dbf0c64ef6d6ecc", symbols: ["node-pty@1.1.0"], owner: "build" },
    ],
    contracts: [
      { name: "acp/initialize.promptCapabilities.image", kind: "schema", signature: "false", stability: "experimental" },
      { name: "sdk/session-prompt.result", kind: "schema", signature: "{ messageId: string }", stability: "experimental" },
    ],
  }
  const after: SourceManifest = {
    project: "deepseek-harness",
    commit: "99f6f02fecdb7dff40c3fbc9470f5907c29f74ca",
    version: "0.1.0-rc.7",
    generatedAt: "2026-08-19T00:00:00Z",
    entries: [
      { path: "package.json", digest: "4229920f59ab2904a9dbecb449c5ede917de0f0f", symbols: ["version=0.1.0-rc.7"], owner: "build" },
      { path: "packages/core/session/src/index.ts", digest: "2d82a88623cf8b8d381f9ba905ba2e7088cbfe12", symbols: ["Session", "SessionStore"], owner: "session" },
      { path: "packages/acp/acp/src/index.ts", digest: "7be2a2bda6e1d30d0f10cd60f12aa0eec274417f", symbols: ["apply", "settleAfterQuiescence", "admitAcpPrompt"], owner: "protocol" },
      { path: "packages/acp/acp/src/content.ts", digest: "66ac7ea3bebac75a53b1515fee0e2e9a910c8b80", symbols: ["supportsAcpImagePrompts", "admitAcpPrompt", "assistantBlockToAcp"], owner: "protocol" },
      { path: "patches/node-pty@1.2.0-beta.15.patch", digest: "74eecb16cdb186fd9aa6fda35af60436ccd60d5b", symbols: ["node-pty@1.2.0-beta.15"], owner: "build" },
    ],
    contracts: [
      { name: "acp/initialize.promptCapabilities.image", kind: "schema", signature: "boolean derived from attachment service and selected model route", stability: "experimental" },
      { name: "sdk/session-prompt.result", kind: "schema", signature: "{ messageId: string }", stability: "experimental" },
    ],
  }
  return { before, after }
}

export function runCapstone(): DriftReport {
  const { before, after } = buildFixture()
  return auditUpgrade(before, after)
}

export function runLesson(): void {
  const report = runCapstone()
  assert(report.blockers.length === 0, "the selected real rc.5 -> rc.7 evidence contains no documented breaking contract")
  assert(report.sourceChanges.some((change) => change.after?.path === "packages/acp/acp/src/content.ts" && change.kind === "added"), "real rich-content source addition must be detected")
  assert(report.compatibility.some((row) => row.target === "acp-client" && row.status === "retest"), "experimental ACP capability drift requires retesting")
  assert(report.migration.some((step) => step.action === "add-test"), "observed contract drift requires a regression test")
  printResult("advanced-07-upstream-evolution-capstone", {
    from: report.from,
    to: report.to,
    blockers: report.blockers,
    compatibility: report.compatibility,
    migration: report.migration,
  }, report.evidence)
}

const entry = process.argv[1] ?? ""
if (entry.endsWith("/07_upstream_evolution_capstone/code.ts") || entry.endsWith("\\07_upstream_evolution_capstone\\code.ts")) runLesson()
