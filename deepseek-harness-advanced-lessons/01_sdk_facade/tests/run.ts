import { strict as nodeAssert } from "node:assert"
import {
  FakeSdkRuntime,
  HarnessSession,
  NotificationSubscription,
  SdkProtocolError,
  WIRE_REQUEST_METHODS,
  disposeRuntimeProcess,
  finalResponse,
  runSdkLab,
} from "../code.ts"

const facts = await runSdkLab()
nodeAssert.deepEqual(facts.wireMethods, ["initialize", "session/prompt", "shutdown"])
nodeAssert.equal(facts.finalResponse, "root answer complete")
nodeAssert.equal(facts.staleIdleExcluded, true)
nodeAssert.equal(facts.childIncluded, true)
nodeAssert.deepEqual(facts.teardown, ["shutdown-request", "stdin-eof", "SIGTERM", "SIGKILL"])
nodeAssert.equal(WIRE_REQUEST_METHODS.includes("session/prompt"), true)
nodeAssert.equal((WIRE_REQUEST_METHODS as readonly string[]).includes("session/cancel"), false)

const runtime = new FakeSdkRuntime()
runtime.initialize()
const result = await new HarnessSession(runtime, "root").run([{ type: "text", text: "hello" }])
nodeAssert.equal(result.messageId, "message-0")
nodeAssert.equal(result.events[0]?.type, "agent/inbox/spliced")
nodeAssert.equal(result.events.at(-1)?.type, "assistant/message")
nodeAssert.equal(result.notifications.at(-1)?.method, "session.status")
nodeAssert.equal(result.notifications.filter((item) => item.method === "subagent.started").length, 1)

nodeAssert.equal(finalResponse([]), "")
nodeAssert.throws(
  () => finalResponse([{ type: "assistant/message", data: { message: { content: "bad" } } }]),
  SdkProtocolError,
)

const subscription = new NotificationSubscription()
subscription.push({ method: "session.status", params: { sessionId: "x", status: "idle" } })
nodeAssert.equal((await subscription.next()).method, "session.status")
subscription.close()
await nodeAssert.rejects(subscription.next(), /closed/)

nodeAssert.deepEqual(disposeRuntimeProcess("eof"), { actions: ["shutdown-request", "stdin-eof"], reaped: true })
nodeAssert.deepEqual(disposeRuntimeProcess("term"), { actions: ["shutdown-request", "stdin-eof", "SIGTERM"], reaped: true })

console.log("advanced L01 tests: ok")
