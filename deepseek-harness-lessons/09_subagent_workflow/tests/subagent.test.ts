import { assert, expectThrows } from "../../common/trace.ts"
import { expected as fixture } from "./fixtures/expected.ts"
import {
  SubagentManager,
  SessionLog,
  replayChild,
  runSubagentLab,
  runWorkflow,
} from "../code.ts"

const manager = new SubagentManager("test-parent")
manager.appendCompletedParentEvent("user/request", { text: "test" })
manager.appendCompletedParentEvent("assistant/plan", { steps: 1 })
const completedPrefix = manager.completedParentPrefix(3)
const freshChild = manager.spawn({ mode: "fresh" })
const fresh = manager.runChild(freshChild.id, "fresh input")
assert(fresh.lineage.forkedEvents === 0, "fresh spawn must not copy a prefix")

const forkChild = manager.spawn({ mode: "fork", completedPrefix })
const fork = manager.runChild(forkChild.id, "fork input")
assert(fork.lineage.mode === "fork" && fork.lineage.forkedEvents === 3, "fork must record copied durable prefix")
assert((forkChild.history[1].data as Record<string, unknown>).text === "test", "fork copies complete event data, not only types")
expectThrows(
  () => manager.spawn({ mode: "fork", completedPrefix: [{ type: "forged/event", data: {} }] }),
  "must match completed parent events",
)

const metadataLog = new SessionLog("trusted-session")
metadataLog.append("test/event", { sessionId: "forged-session", sequence: 999 })
const metadata = metadataLog.events[0].data as Record<string, unknown>
assert(metadata.sessionId === "trusted-session" && metadata.sequence === 1, "event data cannot override log metadata")

const oneShot = manager.spawn({ mode: "fresh" })
manager.runChild(oneShot.id, "done")
expectThrows(() => manager.followUp(oneShot.id, "again"), "one-shot")

const continuable = manager.spawn({ mode: "fresh", continuable: true })
manager.runChild(continuable.id, "first")
manager.followUp(continuable.id, "second")
assert(replayChild(continuable.log).reports.length === 2, "continuation must append a second report")

const failedChild = manager.spawn({ mode: "fresh" })
const failed = manager.runChild(failedChild.id, "bad", "failure")
assert(failed.status === "failed", "failure cannot be represented as empty success")
assert(replayChild(failedChild.log).errors.length === 1, "failure must be durable")

const workflow = runWorkflow(manager, [
  { name: "a", input: "one" },
  { name: "b", input: "two", outcome: "failure" },
])
assert(workflow.reports[1].status === "failed", "workflow must retain failed worker report")
assert(workflow.events.some((event) => event.type === "workflow/barrier.reached"), "workflow has a join barrier")
assert(manager.replayParent().workflowJoined, "workflow join must be durable in parent log")
assert(manager.replayParent().workflowReports.length === 2, "parent replay rebuilds each worker report")
assert(
  manager.replayParent().workflowReports.find((report) => report.childId === workflow.workerIds[1])?.status === "failed",
  "durable workflow replay retains worker failure status",
)

const pending = manager.spawn({ mode: "fresh" })
manager.cancelParent("test cancellation")
assert(manager.getChild(pending.id).status === "cancelled", "parent cancellation owns active children")
manager.disposeParent()
assert(manager.activeChildren().length === 0, "dispose must leave no active children")
manager.parent.disposed = false
assert(manager.replayParent().disposed, "parent replay must use durable dispose event")
manager.parent.disposed = true
expectThrows(() => manager.spawn({ mode: "fresh" }), "disposed")

const lab = runSubagentLab()
assert(lab.parentAndChildLogsAreSeparate, "child process events must not leak into parent projection")
assert(lab.quiescentAfterDispose, "lab must prove quiescence after disposal")
assert(lab.parentProjection.failed.includes(lab.failed.childId), "replay must retain failure identity")
assert(lab.childProjections[lab.cancelledChildId].disposed, "cancelled child still needs disposer evidence")
assert(lab.fresh.lineage.forkedEvents === fixture.freshForkedEvents, "fresh lineage snapshot matches fixture")
assert(lab.fork.lineage.forkedEvents === fixture.forkForkedEvents, "fork lineage snapshot matches fixture")
assert(lab.workflow.workerIds.length === fixture.workflowWorkers, "workflow snapshot matches fixture")
assert(lab.failed.status === fixture.failedStatus, "failure snapshot matches fixture")
assert(lab.childProjections[lab.cancelledChildId].status === fixture.cancelledStatus, "cancel snapshot matches fixture")

console.log("09_subagent_workflow tests: ok")
