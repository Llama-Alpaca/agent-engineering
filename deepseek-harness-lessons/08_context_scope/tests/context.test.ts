import { assert, expectThrows, type TraceEvent } from "../../common/trace.ts"
import { expected as fixture } from "./fixtures/expected.ts"
import {
  AgentContextScope,
  SpillStore,
  assemblePrompt,
  compactHistory,
  extractFacts,
  pruneToolResult,
  runContextLab,
  spillToolResult,
  type CanonicalToolResult,
  type PromptMessage,
} from "../code.ts"

const canonical: CanonicalToolResult = {
  id: "test-result",
  value: "noise\nFACT: keep this claim\nmore noise",
  importantFacts: ["FACT: keep this claim"],
}

const events: TraceEvent[] = []
const pruned = pruneToolResult(canonical, 24, events)
assert(pruned.includes("FACT: keep this claim"), "pruner must retain facts")
assert(pruned.length <= 24, "pruner must honor its character budget")

const store = new SpillStore()
const spilled = spillToolResult(canonical, store, 8, events)
assert(store.get(spilled.locator) === canonical.value, "spill must preserve canonical value")
expectThrows(() => pruneToolResult(canonical, 0), "maxChars")
expectThrows(
  () => pruneToolResult({ ...canonical, value: `FACT: ${"too-long ".repeat(20)}` }, 8),
  "important fact",
)

const history: PromptMessage[] = [
  { role: "user", source: "request", content: "FACT: user requirement\n" + "x".repeat(200) },
  { role: "assistant", source: "plan", content: "plan" },
]
const compacted = compactHistory(history, 48, events)
assert(compacted.count === 1, "long history should compact once")
assert(compacted.preservedFacts.includes("FACT: user requirement"), "compaction must preserve facts")
expectThrows(() => compactHistory(history, 8), "cannot fit budget")

const globalSkills = new Map([["review", "verify source locators"]])
const scopeEvents: TraceEvent[] = []
const scope = new AgentContextScope(globalSkills, scopeEvents)
scope.loadSkill("review")
assert(scope.activeSkills().join(",") === "review", "skill should be scoped to the agent")
scope.dispose()
assert(scope.activeSkills().length === 0, "dispose must remove local skills")
expectThrows(() => scope.loadSkill("review"), "disposed")

const assembled = assemblePrompt({
  persona: "persona",
  runtimeContext: "runtime snapshot",
  toolSchemas: ["read_file(path:string)"],
  skills: ["review"],
  history: [{ role: "user", source: "history", content: "request" }],
})
assert(assembled.messages.filter((message) => message.role === "system").length === 1, "assembly has one rendered system prompt")
assert(assembled.tools.length === 1 && assembled.measurementSections.includes("request.tools"), "tools stay in request metadata")
assert(assembled.messages.some((message) => message.role === "user" && message.source === "skill-catalog"), "skill catalog is represented as user-role content")
assert(
  assembled.messages.findIndex((message) => message.source === "history") < assembled.messages.findIndex((message) => message.source === "runtime-context-snapshot"),
  "pre-step snapshots follow the existing session history",
)

const lab = runContextLab()
const raw = lab.measurements.find((item) => item.strategy === "raw")!
const spill = lab.measurements.find((item) => item.strategy === "spill")!
const compact = lab.measurements.find((item) => item.strategy === "compact")!
const combined = lab.measurements.find((item) => item.strategy === "combined")!
assert(combined.modelVisibleTokens < raw.modelVisibleTokens, "combined view should save model-visible tokens")
assert(new Set(lab.measurements.map((item) => item.syntheticCanonicalBytes)).size === 1, "view strategies cannot rewrite the synthetic canonical serialization")
assert(spill.locators.length === 1 && combined.locators.length === 1, "spill strategies must expose a locator")
assert(compact.compactionCount === 1, "compact strategy must create one checkpoint")
assert(combined.compactionCount === 0, "combined strategy stays under this fixture's compaction budget")
assert(lab.spillCanonicalIntact, "lab must prove canonical spill preservation")
assert(lab.scopeDisposed, "lab must dispose agent scope")
assert(lab.secondScopeSkills.length === 0 && lab.promptSkillIsolation, "second scope prompt must not contain repo-review")
assert(lab.firstPromptHasScopedSkill, "first scope prompt must positively include its loaded skill")
assert(extractFacts(combined.preservedFacts.join("\n")).length >= 3, "facts remain inspectable after transforms")
assert(JSON.stringify(lab.measurements.map((item) => item.strategy)) === JSON.stringify(fixture.strategies), "strategy snapshot matches fixture")
assert(raw.preservedFacts.length === fixture.importantFactCount, "fact-count snapshot matches fixture")
assert(JSON.stringify(lab.scopeSkillsBeforeDispose) === JSON.stringify(fixture.loadedSkills), "loaded skill snapshot matches fixture")
assert(JSON.stringify(lab.secondScopeSkills) === JSON.stringify(fixture.secondScopeSkills), "isolated scope snapshot matches fixture")

console.log("08_context_scope tests: ok")
