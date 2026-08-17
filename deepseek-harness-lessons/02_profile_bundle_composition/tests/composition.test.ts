import { strict as nodeAssert } from "node:assert"
import {
  Loader,
  composeLayers,
  demoLayers,
  dumpConfig,
  naiveDeepMerge,
  resolveActivation,
  validateComposition,
} from "../code.ts"

const layers = demoLayers()
const composition = composeLayers([layers.base, layers.headless, layers.profile])
validateComposition(composition)
const agent = composition.rows.find(row => row.id === "agent")
nodeAssert.equal(agent?.source, "bundle:base")
nodeAssert.deepEqual(agent?.patchedBy, ["profile:course"])
nodeAssert.deepEqual(agent?.config, { maxSteps: 12, mode: "headless", retry: { max: 3 } })
nodeAssert.equal(dumpConfig(composition).find(row => row.id === "surface")?.name, "dsh-headless")
const pending = resolveActivation(composeLayers([layers.base]).rows, ["http"])
nodeAssert.equal(pending.find(row => row.id === "llm")?.status, "pending")
nodeAssert.deepEqual(naiveDeepMerge({ retry: { max: 2 }, mode: "headless" }, { maxSteps: 12 }), {
  retry: { max: 2 },
  mode: "headless",
  maxSteps: 12,
})
const loader = new Loader()
loader.load([layers.base, layers.headless], ["credentials", "http"])
loader.load([layers.base, layers.headless, layers.overlay], ["credentials", "http"])
const disposeIndex = loader.events.findIndex(event => event.type === "loader/dispose")
const startIndex = loader.events.findIndex(event => event.type === "loader/start" && Number(event.data.generation) === 2)
nodeAssert.ok(disposeIndex >= 0 && startIndex > disposeIndex)
loader.dispose()
console.log("L02 tests: ok")
