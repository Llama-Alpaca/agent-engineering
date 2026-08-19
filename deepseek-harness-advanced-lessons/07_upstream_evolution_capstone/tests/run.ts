import { strict as nodeAssert } from "node:assert"
import { auditUpgrade, buildCompatibilityMatrix, buildFixture, compareContracts, compareSources, runCapstone, validateManifest, type SourceManifest } from "../code.ts"

const { before, after } = buildFixture()
nodeAssert.deepEqual(validateManifest(before), [])
nodeAssert.deepEqual(validateManifest(after), [])

const sources = compareSources(before, after)
nodeAssert.equal(sources.find((change) => change.before?.path === "package.json")?.kind, "modified")
nodeAssert.equal(sources.find((change) => change.before?.path === "packages/core/session/src/index.ts")?.kind, "unchanged")
nodeAssert.equal(sources.find((change) => change.before?.path === "packages/acp/acp/src/index.ts")?.kind, "modified")
nodeAssert.equal(sources.find((change) => change.after?.path === "packages/acp/acp/src/content.ts")?.kind, "added")
nodeAssert.equal(sources.find((change) => change.before?.path === "patches/node-pty@1.1.0.patch")?.kind, "removed")

const contracts = compareContracts(before, after)
nodeAssert.equal(contracts.find((change) => change.name === "schema:acp/initialize.promptCapabilities.image")?.severity, "review")
nodeAssert.equal(contracts.find((change) => change.name === "schema:sdk/session-prompt.result")?.kind, "unchanged")

const report = runCapstone()
nodeAssert.deepEqual(report.blockers, [])
nodeAssert.equal(report.compatibility.find((row) => row.target === "acp-client")?.status, "retest")
nodeAssert.equal(report.compatibility.find((row) => row.target === "sdk-facade")?.status, "compatible")
nodeAssert.equal(report.compatibility.find((row) => row.target === "job-plugin")?.status, "compatible")
nodeAssert.ok(report.migration.some((step) => step.action === "manual-review"))
nodeAssert.ok(report.migration.some((step) => step.action === "add-test"))
nodeAssert.equal(report.evidence.at(-1)?.type, "upgrade/gate")

const invalid = { ...after, commit: "not-a-sha" }
nodeAssert.ok(validateManifest(invalid).some((message) => message.includes("git SHA")))
nodeAssert.ok(auditUpgrade(before, invalid).blockers.some((message) => message.startsWith("after:")))

const customMatrix = buildCompatibilityMatrix(contracts, [{ name: "image-client", contracts: ["schema:acp/initialize.promptCapabilities.image"] }])
nodeAssert.equal(customMatrix[0]?.status, "retest", "an experimental capability change requires target-specific retesting")

const movedBefore: SourceManifest = {
  ...before,
  entries: [{ path: "packages/example/src/old.ts", digest: "same-blob", symbols: ["Example"], owner: "test" }],
  contracts: [],
}
const movedAfter: SourceManifest = {
  ...after,
  entries: [{ path: "packages/example/src/new.ts", digest: "same-blob", symbols: ["Example"], owner: "test" }],
  contracts: [],
}
nodeAssert.equal(compareSources(movedBefore, movedAfter)[0]?.kind, "moved", "the generic audit still detects exact synthetic moves")

const breakingBefore: SourceManifest = {
  ...before,
  entries: [],
  contracts: [{ name: "published/result", kind: "schema", signature: "{ value: string }", stability: "documented" }],
}
const breakingAfter: SourceManifest = {
  ...after,
  entries: [],
  contracts: [{ name: "published/result", kind: "schema", signature: "{ value: number }", stability: "documented" }],
}
nodeAssert.ok(auditUpgrade(breakingBefore, breakingAfter).blockers.includes("breaking contract: schema:published/result"))

console.log("advanced L07 tests: ok")
