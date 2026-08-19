import { strict as nodeAssert } from "node:assert"
import {
  CompletionReporter,
  LocalJobRegistry,
  ManualProducer,
  WorkflowError,
  WorkflowRuntime,
  runJobsWorkflowLab,
  utf8Cap,
  type Owner,
} from "../code.ts"

const facts = runJobsWorkflowLab()
nodeAssert.equal(facts.capacityHeldUntilDone, true)
nodeAssert.equal(facts.replacementCanRead, "completed")
nodeAssert.equal(facts.bobCanRead, false)
nodeAssert.deepEqual(facts.deliveries, ["wakeup", "quiet"])
nodeAssert.ok(Number(facts.cappedBytes) <= 24)
nodeAssert.equal(facts.processRestartJobs, 0)
nodeAssert.deepEqual(facts.workflowGood, { answer: 42 })
nodeAssert.equal(facts.workflowOrdinaryFailure, null)
nodeAssert.deepEqual(facts.workflowAgentPairs, [
  "workflow/agent-start:good", "workflow/agent-end:good",
  "workflow/agent-start:ordinary", "workflow/agent-end:ordinary",
])

const owner: Owner = { agentId: "a", sessionId: "s", instance: 1 }
const registry = new LocalJobRegistry(1)
registry.attachController("s")
const producer = new ManualProducer()
const id = registry.start({ owner, label: "x", producer })
producer.cancelThrows = true
nodeAssert.throws(() => registry.kill(id, owner), /cancel failed/)
nodeAssert.equal(registry.get(id, owner).status, "running")
producer.cancelThrows = false
nodeAssert.equal(registry.kill(id, owner), "requested")
nodeAssert.equal(registry.get(id, owner).status, "stopping")
producer.settle({ status: "killed" })
producer.settle({ status: "completed" })
nodeAssert.equal(registry.get(id, owner).status, "killed", "first terminal outcome must win")
nodeAssert.equal(registry.activeCount(owner), 0)

const reporter = new CompletionReporter({ completionDelivery: "wakeup", maxConsecutiveWakes: 2, outputLimitBytes: 5 })
reporter.setBusy("s", true)
reporter.report({ id: "j", ownerSession: "s", status: "completed", label: "任务", reported: false, output: "完成" }, owner)
nodeAssert.equal(reporter.notices[0]?.delivery, "step")
nodeAssert.ok(Buffer.byteLength(reporter.notices[0]?.text ?? "") <= 5)
nodeAssert.doesNotMatch(utf8Cap("你好世界", 5), /�/)

const cancelled = new WorkflowRuntime()
cancelled.start()
cancelled.cancel()
nodeAssert.equal(cancelled.agent("late", () => "never"), null)
nodeAssert.deepEqual(cancelled.events.slice(-2).map((event) => event.type), ["workflow/agent-start", "workflow/agent-end"])
nodeAssert.equal(cancelled.events.at(-1)?.data.reason, "cancelled")

const fatal = new WorkflowRuntime()
fatal.start()
nodeAssert.throws(() => fatal.agent("fatal", () => { throw new WorkflowError("worker died", true) }), /worker died/)
nodeAssert.equal(fatal.events.at(-1)?.type, "workflow/agent-end")
nodeAssert.throws(() => new WorkflowRuntime().agent("exotic", () => new Date()), /exotic prototype/)

console.log("advanced L04 tests: ok")
