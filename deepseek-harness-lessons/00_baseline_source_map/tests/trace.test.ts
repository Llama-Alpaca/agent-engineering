import { strict as nodeAssert } from "node:assert"
import {
  LOCKED_COMMIT,
  assertBalancedTrace,
  buildBaselineEventTrace,
  buildSourceMap,
  consumeScriptedStream,
  readLockedMetadata,
} from "../code.ts"

const { lock, manifest } = readLockedMetadata()
nodeAssert.equal(lock.commit, LOCKED_COMMIT)
nodeAssert.equal(manifest.commit, LOCKED_COMMIT)
const map = buildSourceMap(lock, manifest)
nodeAssert.equal(map.anchors.length, 6)
const events = buildBaselineEventTrace()
assertBalancedTrace(events)
nodeAssert.equal(events.filter(event => event.data.stream === "durable").length, 9)
nodeAssert.equal(events.filter(event => event.data.stream === "live").length, 6)
const stream = await consumeScriptedStream()
nodeAssert.deepEqual(stream, { text: "source map", usage: "12+2" })
console.log("L00 tests: ok")
