import { createHash } from "node:crypto"
import { assert, expectThrows } from "../../common/trace.ts"
import { expected as fixture } from "./fixtures/expected.ts"
import {
  AuditableBundle,
  DurableSession,
  EvidenceCapabilityDefinition,
  repoEvidenceTool,
  runCapstoneLab,
  type PersistedSession,
} from "../code.ts"

const definition = new EvidenceCapabilityDefinition()
const local = definition.createProvider("local").inspect("src/agent-loop.ts")
const remote = definition.createProvider("fake-remote").inspect("src/agent-loop.ts")
assert(local.length === remote.length && local.length > 0, "both providers satisfy the evidence definition")
assert(local[0].claim === remote[0].claim, "provider replacement keeps semantic claims")
assert(local[0].locator.startsWith("file://"), "local provider returns file locator")
assert(remote[0].locator.startsWith("remote://"), "remote provider returns remote locator")
assert(repoEvidenceTool.inputSchema.required.includes("path"), "model-facing input schema requires path")
assert(repoEvidenceTool.outputSchema.required.includes("locators"), "model-facing output schema requires locators")
assert(repoEvidenceTool.outputSchema.properties.records.items.required.includes("locator"), "record item schema requires locator")

const bundle = new AuditableBundle()
bundle.install()
bundle.install()
assert(bundle.registry.size === 3, "repeat install must be idempotent")

const deniedBeforeObserve = bundle.modify("src/agent-loop.ts", "edit")
assert(deniedBeforeObserve.decision === "deny", "modify must require prior observation")
const observed = bundle.headless("src/agent-loop.ts")
assert(observed.ok && observed.locators.length > 0, "repo_evidence returns cited records")
const allowed = bundle.modify("src/agent-loop.ts", "safe edit")
assert(allowed.decision === "allow", "observed workspace path may be modified")

const ask = bundle.modify("src/agent-loop.ts", "dangerous edit", { dangerous: true })
assert(ask.decision === "ask" && ask.requestId !== undefined, "dangerous action must ask")
expectThrows(() => bundle.approve("approval-forged"), "unknown approval request")
assert(
  bundle.audit.events.some((event) => event.type === "policy.denied" && event.data.action === "approve"),
  "forged approval attempt must be durable",
)
const forged = bundle.modify("src/agent-loop.ts", "forged edit", {
  dangerous: true,
  approvalId: "approval-forged",
})
assert(forged.decision === "deny", "forged approval id must fail closed")
bundle.headless("README.md")
bundle.approve(ask.requestId!)
const mismatched = bundle.modify("README.md", "wrong target", {
  dangerous: true,
  approvalId: ask.requestId,
})
assert(mismatched.decision === "deny", "approval must be bound to its normalized path")
const mismatchedContent = bundle.modify("src/agent-loop.ts", "different dangerous edit", {
  dangerous: true,
  approvalId: ask.requestId,
})
assert(mismatchedContent.decision === "deny", "approval must be bound to the exact content")
const safeWithApproval = bundle.modify("src/agent-loop.ts", "dangerous edit", {
  approvalId: ask.requestId,
})
assert(safeWithApproval.decision === "deny", "approval id cannot be smuggled onto a safe action")
const approved = bundle.modify("src/agent-loop.ts", "dangerous edit", {
  dangerous: true,
  approvalId: ask.requestId,
})
assert(approved.decision === "allow", "approved dangerous action may proceed")
const reusedApproval = bundle.modify("src/agent-loop.ts", "reuse approval", {
  dangerous: true,
  approvalId: ask.requestId,
})
assert(reusedApproval.decision === "deny", "consumed approval must fail closed")
const outside = bundle.modify("../private.txt", "escape")
assert(outside.decision === "deny", "workspace escape must fail closed")
assert(bundle.projection().deniedActions.length >= 2, "denials must be queryable from durable projection")
const empty = bundle.headless("src/missing.ts")
assert(!empty.ok, "empty evidence must not be reported as success")
assert(bundle.modify("src/missing.ts", "create from nothing").decision === "deny", "empty evidence must not mark a path observed")

const toolIdentity = bundle.tool
bundle.selectProvider("fake-remote")
const sdk = bundle.pythonSdk("src/agent-loop.ts")
assert(bundle.tool === toolIdentity, "provider swap must not replace the consumer tool")
assert(sdk.provider === "fake-remote", "configuration selects fake remote provider")

const canonical = [
  "noise=" + "x".repeat(500),
  "FACT: retain this",
  "FACT: keep locator",
  "FACT: preserve policy",
].join("\n")
const view = bundle.context.project(canonical)
assert(view.locator !== undefined, "long result should spill")
assert(view.compactionCount === 1, "long projected view should compact")
assert(bundle.context.read(view.locator!) === canonical, "spill keeps canonical value")
assert(view.view.includes("FACT: retain this"), "compaction keeps marked facts")
assert(view.view.includes(view.locator!), "compaction keeps the canonical spill locator model-visible")
const medium = "m".repeat(120)
const mediumView = bundle.context.project(medium)
assert(mediumView.locator !== undefined, "a result over the compaction budget must spill before projection")
assert(bundle.context.read(mediumView.locator) === medium, "medium spill remains recoverable")

const reports = bundle.runFreshReadOnlyReview(["README.md", "packages/evidence/index.ts"])
assert(reports.every((report) => report.mode === "fresh" && report.readonly), "review children are fresh and read-only")
assert(reports.every((report) => report.status === "succeeded"), "each review has an explicit terminal state")
assert(bundle.audit.events.some((event) => event.type === "subagent.barrier"), "parallel review records a start barrier")
assert(bundle.audit.events.some((event) => event.type === "subagent.joined"), "parallel review records a join")
const isolatedReviewBundle = new AuditableBundle()
isolatedReviewBundle.runFreshReadOnlyReview(["README.md"])
assert(
  isolatedReviewBundle.modify("README.md", "parent write").decision === "deny",
  "child observation must not contaminate parent policy state",
)

const saved = bundle.session.serialize()
const resumed = DurableSession.resume(saved)
assert(JSON.stringify(resumed.modelHistory) === JSON.stringify(bundle.session.modelHistory), "resume retains model history")
assert(JSON.stringify(resumed.audit.projection()) === JSON.stringify(bundle.audit.projection()), "resume retains audit projection")
const resumedAuditCount = resumed.audit.events.length
const resumedBundle = new AuditableBundle({}, resumed)
assert(resumedBundle.providerKind === "fake-remote", "resume restores the last selected provider")
assert(resumed.audit.events.length === resumedAuditCount, "rehydration must not append a duplicate provider selection")
assert(resumedBundle.context.read(view.locator!) === canonical, "resume restores spilled canonical evidence")
assert(resumedBundle.modify("src/agent-loop.ts", "continued safe edit").decision === "allow", "resume rebuilds observed policy state")
assert(
  resumedBundle.modify("src/agent-loop.ts", "reused dangerous edit", { dangerous: true, approvalId: ask.requestId }).decision === "deny",
  "resume does not revive consumed approvals",
)
const nextAsk = resumedBundle.modify("src/agent-loop.ts", "new dangerous edit", { dangerous: true })
assert(nextAsk.requestId !== ask.requestId, "resume must not reuse an old approval id")

const tampered = JSON.parse(saved) as PersistedSession
const bad: PersistedSession = { ...tampered, modelHistory: [...tampered.modelHistory, { role: "assistant", content: "not audited" }] }
expectThrows(() => DurableSession.resume(bad), "disagrees")

bundle.uninstall()
const registrationsAfterUninstall: number = bundle.registry.size
assert(registrationsAfterUninstall === 0, "uninstall must remove every registration")

const lab = runCapstoneLab()
const repeatedLab = runCapstoneLab()
assert(lab.providerSwapConsumerUnchanged, "capstone swaps provider through configuration only")
assert(lab.unobservedModify.decision === "deny", "capstone enforces observe-before-modify")
assert(lab.outsideModify.decision === "deny", "capstone rejects outside writes")
assert(lab.dangerousAsk.decision === "ask" && lab.dangerousApproved.decision === "allow", "approval retry is audited")
assert(lab.resumeConsistent, "capstone projection survives resume")
assert(lab.registrationsAfterUninstall === 0, "capstone unload is complete")
assert(!lab.coreAgentLoopTouched, "bundle must not modify the core agent loop")
assert(lab.contextCanonicalIntact && lab.context.compactionCount === 1, "capstone proves spill and compaction invariants")
assert(lab.context.locator !== undefined && lab.context.view.includes(lab.context.locator), "capstone checkpoint retains locator")
assert(lab.contextResumeIntact, "capstone restores spilled evidence after resume")
assert(lab.evidenceMatrix.find((row) => row.kind === "unit")?.status === "pass", "unit evidence must be derived from observed outcomes")
assert(lab.evidenceMatrix.find((row) => row.kind === "course-composition")?.status === "pass", "offline course stack composes")
assert(lab.evidenceMatrix.find((row) => row.kind === "real-composition")?.status === "skip", "upstream Loader composition is not overclaimed")
assert(lab.evidenceMatrix.find((row) => row.kind === "real-api-smoke")?.status === "skip", "real API remains optional")
assert(lab.snapshot === repeatedLab.snapshot, "two keyless capstone runs produce the same durable snapshot")
assert(createHash("sha256").update(lab.snapshot).digest("hex") === fixture.snapshotSha256, "capstone snapshot matches fixture digest")
assert(lab.localHeadless.provider === fixture.localProvider && lab.remoteSdk.provider === fixture.remoteProvider, "provider snapshot matches fixture")
assert(lab.unobservedModify.decision === fixture.unobservedDecision, "unobserved policy snapshot matches")
assert(lab.dangerousAsk.decision === fixture.dangerousDecision, "dangerous policy snapshot matches")
assert(lab.dangerousApproved.decision === fixture.approvedDecision, "approved policy snapshot matches")
assert(lab.outsideModify.decision === fixture.outsideDecision, "outside policy snapshot matches")
assert(lab.evidenceMatrix.find((row) => row.kind === "real-composition")?.status === fixture.realComposition, "real-composition snapshot matches")
assert(lab.evidenceMatrix.find((row) => row.kind === "real-api-smoke")?.status === fixture.realApi, "real-API snapshot matches")

console.log("11_capstone_auditable_bundle tests: ok")
