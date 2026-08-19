import { strict as nodeAssert } from "node:assert"
import { AgentPresetRoster, PresetCatalog, buildCatalog, runPresetLab } from "../code.ts"

const facts = runPresetLab()
nodeAssert.equal(facts.sharedMount, true)
nodeAssert.equal(facts.mountAttempts, 3)
nodeAssert.notEqual(facts.parentGeneration, facts.laterGeneration)
nodeAssert.equal(facts.parentGeneration, facts.existingChildGeneration)
nodeAssert.equal(facts.oldGenerationStillJoined, 4)
nodeAssert.equal(facts.failedPreserved, true)
nodeAssert.match(String(facts.deletedLiveService), /my-preset@.*:skills/)

const catalog = buildCatalog()
const roster = new AgentPresetRoster(catalog)
roster.createSession("a")
roster.mount("a", "standard")
nodeAssert.match(roster.serviceForAgent("a", "tools") ?? "", /standard@1:tools/)
nodeAssert.equal(roster.serviceForAgent("a", "unknown"), undefined)
roster.markNonBlank("a")
nodeAssert.throws(() => roster.recompose("a", "standard"), /blank/)

roster.createSession("unbound")
nodeAssert.equal(roster.composeFrom("child-of-bare", "unbound"), undefined)
nodeAssert.throws(() => roster.mount("second", "broken"), /broken.*invalid YAML/)
nodeAssert.equal(roster.mountAttempts, 1, "broken discovery must fail before a mount attempt")

const unsafe = new PresetCatalog([{ id: "leak", trust: "user", root: "/user", stamp: "1", rows: [{ id: "x", service: "root", publishesGlobalService: true }] }])
const unsafeRoster = new AgentPresetRoster(unsafe)
unsafeRoster.createSession("x")
nodeAssert.throws(() => unsafeRoster.mount("x", "leak"), /process-global/)

nodeAssert.throws(() => catalog.copy("standard", "../escape", "/user"), /invalid preset id/)
nodeAssert.throws(() => catalog.delete("standard"), /ships with/)

console.log("advanced L03 tests: ok")
