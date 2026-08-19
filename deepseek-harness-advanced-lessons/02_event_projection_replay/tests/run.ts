import { strict as nodeAssert } from "node:assert"
import { ConversationWindow, ProjectionValueStore, ToolCallTree, flattenLineage, runProjectionLab } from "../code.ts"

const facts = runProjectionLab()
nodeAssert.deepEqual(facts.beforeTruncate, { title: "live", usage: 11 })
nodeAssert.deepEqual(facts.afterTruncate, { usage: 11 })
nodeAssert.equal(facts.toolIdentityStable, true)
nodeAssert.deepEqual(facts.nodeOrder, ["m0", "m1", "m2", "call"])
nodeAssert.deepEqual(facts.lineage, ["0:root", "1:child", "0:orphan"])
nodeAssert.deepEqual(facts.edges, [true, true, false])

const store = new ProjectionValueStore()
nodeAssert.equal(store.apply("title", "new", 4), true)
nodeAssert.equal(store.apply("title", "same", 4), false)
nodeAssert.equal(store.apply("title", "old", 3), false)
store.seed({ asOfSeq: 2, values: {} })
nodeAssert.equal(store.get("title"), "new", "stale omission must not clear newer data")
store.seed({ asOfSeq: 4, values: {} })
nodeAssert.equal(store.get("title"), undefined, "omission at the same cut means capability absent")

const window = new ConversationWindow()
window.replaceWindow([{ seq: 0, type: "message", id: "a", text: "a" }], false)
nodeAssert.equal(window.append({ seq: 0, type: "message", id: "duplicate" }), false)
nodeAssert.throws(() => window.append({ seq: 2, type: "message", id: "gap" }), /gap/)
nodeAssert.equal(window.append({ seq: 1, type: "tool/start", id: "x" }), true)
nodeAssert.throws(() => window.append({ seq: 2, type: "tool/end", id: "unknown" }), /no start/)

const cycle = flattenLineage([
  { sessionId: "a", parentSessionId: "b", title: "a" },
  { sessionId: "b", parentSessionId: "a", title: "b" },
])
nodeAssert.deepEqual(cycle.map((row) => row.sessionId), ["a", "b"])
nodeAssert.deepEqual(cycle.map((row) => row.depth), [0, 1])

const tree = new ToolCallTree(2)
nodeAssert.equal(tree.add("r", "c"), true)
nodeAssert.equal(tree.add("c", "too-deep"), false)
nodeAssert.deepEqual(tree.descendants("r"), ["c"])

console.log("advanced L02 tests: ok")
