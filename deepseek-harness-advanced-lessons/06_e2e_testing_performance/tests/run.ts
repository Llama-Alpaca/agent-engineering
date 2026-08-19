import { strict as nodeAssert } from "node:assert"
import {
  APPROVED_OFFLINE_FIXTURE,
  MiniHarnessRuntime,
  UPSTREAM_EVIDENCE,
  modelWorkloadCost,
  projectOfflineFixture,
  runLayeredReport,
  runVirtualCostChecks,
  signature,
} from "../code.ts"

const report = runLayeredReport()
nodeAssert.equal(report.allCourseChecksPassed, true)
nodeAssert.deepEqual(report.unclaimedEvents, [])
nodeAssert.equal(report.courseClaims.length, 9)
nodeAssert.equal(report.virtualCosts.length, 2)
nodeAssert.ok(report.courseClaims.every((claim) => claim.limitation.length > 0))
nodeAssert.ok(report.virtualCosts.every((row) => row.deterministic && row.p95Units >= row.p50Units))

nodeAssert.deepEqual(
  report.upstreamEvidence.map((row) => row.lane),
  ["unit", "coverage-gate", "real-api-e2e", "keyless-snapshot", "web-browser-snapshot", "manual-web-perf", "opt-in-web-stress"],
)
nodeAssert.ok(UPSTREAM_EVIDENCE.every((row) => row.status === "skip"))
nodeAssert.equal(report.upstreamEvidence.find((row) => row.lane === "keyless-snapshot")?.command, "pnpm run test:snapshot")
nodeAssert.equal(report.upstreamEvidence.find((row) => row.lane === "web-browser-snapshot")?.command, "pnpm run test:web")
nodeAssert.match(report.upstreamEvidence.find((row) => row.lane === "opt-in-web-stress")?.provesWhenRun ?? "", /100,000/)
nodeAssert.match(report.upstreamEvidence.find((row) => row.lane === "opt-in-web-stress")?.limitation ?? "", /250 ms/)

const cancelled = new MiniHarnessRuntime({ cancelAfterSteps: 1 }).run("cancel")
nodeAssert.equal(cancelled.status, "cancelled")
nodeAssert.equal(cancelled.events.some((item) => item.type === "assistant/message"), false)
const approved = new MiniHarnessRuntime({ approvalRequired: true }).run("approved", true)
nodeAssert.equal(approved.status, "completed")
const fixture = projectOfflineFixture(new MiniHarnessRuntime({ approvalRequired: true }).run("scenario", true))
nodeAssert.deepEqual(fixture, APPROVED_OFFLINE_FIXTURE)
nodeAssert.deepEqual(fixture.projection.messages, ["done:scenario"])
nodeAssert.equal(new MiniHarnessRuntime().run("same").durableSignature, new MiniHarnessRuntime().run("same").durableSignature)
nodeAssert.notEqual(signature(cancelled.events), signature(approved.events))

const row = modelWorkloadCost("tiny", { streamDeltas: false, toolWorkUnits: 1 }, 4)
nodeAssert.equal(row.calls, 4)
nodeAssert.equal(row.deterministic, true)
nodeAssert.equal(runVirtualCostChecks()[0]?.passed, true)
nodeAssert.equal("p50" in row, false)
nodeAssert.equal("p50Units" in row, true)

console.log("advanced L06 tests: ok")
