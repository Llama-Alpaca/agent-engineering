import { strict as nodeAssert } from "node:assert"
import {
  Agent,
  ScriptedLLM,
  assertBalancedAgent,
  runCancellation,
} from "../code.ts"

const inboxAgent = new Agent("inbox", new ScriptedLLM([{ kind: "text", chunks: ["done"] }]))
inboxAgent.inject({ id: "quiet", content: "context", source: "user" })
nodeAssert.equal(inboxAgent.status, "idle")
inboxAgent.steer({ id: "wake", content: "go", source: "user" })
nodeAssert.equal(inboxAgent.status, "running")
await inboxAgent.whenIdle()
assertBalancedAgent(inboxAgent)
nodeAssert.deepEqual(
  inboxAgent.durable.filter(item => item.type === "user/message").map(item => item.data.id),
  ["quiet", "wake"],
)

const toolAgent = new Agent("tool", new ScriptedLLM([
  { kind: "tool", chunks: ["plan"], callId: "c-1", name: "read", arguments: "{}" },
  { kind: "text", chunks: ["answer"] },
]))
toolAgent.followup({ id: "prompt", content: "read", source: "user" })
await toolAgent.whenIdle()
assertBalancedAgent(toolAgent)
nodeAssert.equal(toolAgent.durable.filter(item => item.type === "step/start").length, 2)
nodeAssert.equal(toolAgent.durable.filter(item => item.type === "tool/call").length, 1)
nodeAssert.equal(toolAgent.durable.filter(item => item.type === "tool/result").length, 1)

for (const point of ["pre-step", "stream", "tool"] as const) {
  const canceled = await runCancellation(point)
  assertBalancedAgent(canceled)
  nodeAssert.match(String(canceled.durable.find(item => item.type === "turn/end")?.data.reason), /^aborted:/)
}

await toolAgent.dispose()
nodeAssert.equal(toolAgent.disposed, true)
nodeAssert.throws(() => toolAgent.followup({ id: "late", content: "late", source: "user" }), /disposed/)
console.log("L03 tests: ok")
