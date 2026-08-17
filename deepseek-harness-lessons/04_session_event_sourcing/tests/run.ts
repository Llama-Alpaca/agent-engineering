import { assert } from "../../common/trace.ts"
import {
  EventLog,
  assertRequestReconstructable,
  buildFixture,
  deriveMessages,
  runLesson,
} from "../code.ts"

const fixture = buildFixture()
const before = fixture.log.snapshot()
assert(before.length === 8, "fixture should contain eight durable events")
assert(before[0]?.seq === 0, "session sequence must start at zero")
assert(deriveMessages(fixture.log).length === 1, "surface replacement should leave one summary")
assert(fixture.requestHeader.provider === "deepseek", "request header provider drifted")

const encoded = fixture.log.toJsonl()
const resumed = EventLog.fromJsonl(encoded, fixture.log.lineage)
assert(JSON.stringify(resumed.snapshot()) === JSON.stringify(before), "resume must be byte-stable")

const child = fixture.log.fork(4, "test-child")
const parentSize = fixture.log.size
child.append({ type: "user/message", surfaceOp: "append", data: { message: { id: "child", role: "user", content: "follow up" } } })
assert(fixture.log.size === parentSize, "fork append changed parent")
assert(child.lineage.parentSessionId === "parent", "fork lineage missing parent")
assert(child.size === 6, "inclusive fork boundary should copy seq 0 through 4")

const invalid = new EventLog(before, fixture.log.lineage)
let rejected = false
try {
  assertRequestReconstructable(invalid, {
    requestId: "req-1",
    atSeq: fixture.requestAtSeq,
    visibleMessages: [{ id: "ghost", role: "user", content: "unlogged" }],
  })
} catch (error) {
  rejected = error instanceof Error && error.message.includes("unlogged")
}
assert(rejected, "unlogged model context must be rejected")

const facts = runLesson()
assert(facts.resumeEqual, "lesson resume fact should be true")
console.log("L04 tests: ok")
