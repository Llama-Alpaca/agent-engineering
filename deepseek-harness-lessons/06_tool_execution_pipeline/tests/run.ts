import { assert } from "../../common/trace.ts"
import {
  ToolRuntime,
  runBatched,
  runCodeModeSubcalls,
  runRollingPool,
  defineTool,
} from "../code.ts"

const echo = defineTool({
  name: "echo",
  concurrency: "safe",
  schema: (value: unknown) => {
    if (typeof value !== "object" || value === null || typeof (value as Record<string, unknown>).value !== "string") {
      throw new Error("bad schema")
    }
    return value as { value: string }
  },
  modelRender: (input) => input.value,
  execute: async (input) => {
    await Promise.resolve()
    return { z: 1, value: input.value }
  },
})
const exclusive = defineTool({
  name: "exclusive",
  concurrency: "exclusive",
  schema: () => ({}),
  modelRender: () => "exclusive",
  execute: () => ({ ok: true }),
})

const runtime = new ToolRuntime([echo, exclusive], {
  policy: (call) => (call.name === "exclusive" ? "deny" : "allow"),
})
const batch = await runBatched(runtime, [
  { id: "e2", name: "echo", arguments: { value: "two" }, order: 2 },
  { id: "x", name: "exclusive", arguments: {}, order: 3 },
  { id: "e1", name: "echo", arguments: { value: "one" }, order: 1 },
])
assert(batch.results.length === 3, "batch result count")
assert(batch.results[1]?.status === "denied", "exclusive policy should deny")
assert(batch.committedIds.join(",") === "e1,e2,x", "commit should use model order")

const controller = new AbortController()
let starts = 0
const cancellable = new ToolRuntime([echo], {
  policy: () => "allow",
  onStart: () => {
    starts += 1
    if (starts === 1) controller.abort()
  },
})
const pool = await runRollingPool(
  cancellable,
  [
    { id: "a", name: "echo", arguments: { value: "a" }, order: 1 },
    { id: "b", name: "echo", arguments: { value: "b" }, order: 2 },
  ],
  1,
  controller.signal,
)
assert(pool.results.filter((result) => !result.started).length === 1, "pending call needs synthetic cancellation")
assert(new Set(pool.results.map((result) => result.id)).size === 2, "one result per call")

let invalidTimeoutEffects = 0
const timeoutTool = defineTool({
  name: "timeout_probe",
  concurrency: "safe",
  schema: () => ({}),
  modelRender: () => "timeout probe",
  execute: () => {
    invalidTimeoutEffects += 1
    return { ok: true }
  },
})
const invalidTimeout = await new ToolRuntime([timeoutTool]).run({
  id: "invalid-timeout",
  name: "timeout_probe",
  arguments: {},
  order: 1,
  timeoutMs: -1,
})
assert(invalidTimeout.status === "error" && invalidTimeout.error?.code === "INVALID_TIMEOUT", "invalid timeout must fail input validation")
assert(!invalidTimeout.started && invalidTimeoutEffects === 0, "invalid timeout executed a side effect")

const postAbort = new AbortController()
const cancelledInPost = await new ToolRuntime([echo], {
  postExecute: [(_context, output) => {
    postAbort.abort()
    return output
  }],
}).run({ id: "post-abort", name: "echo", arguments: { value: "x" }, order: 1 }, postAbort.signal)
assert(cancelledInPost.status === "cancelled", "abort inside post-execute must win before final result")

let guardedEffects = 0
const guardedTool = defineTool({
  name: "guarded",
  concurrency: "safe",
  schema: () => ({}),
  modelRender: () => "guarded",
  execute: () => {
    guardedEffects += 1
    return { secret: "raw", visible: "ok" }
  },
  finalizeContent: (value) => ({ ...(value as Record<string, unknown>), secret: "[redacted]" }),
})
const guardedRuntime = new ToolRuntime([guardedTool], { guards: [() => "scope policy denied"] })
const guarded = await runCodeModeSubcalls(guardedRuntime, [
  { id: "nested-denied", name: "guarded", arguments: {}, order: 1 },
])
assert(guarded.results[0]?.status === "denied" && guardedEffects === 0, "Code Mode sub-call bypassed the guard")
assert(guardedRuntime.events.some((event) => event.type === "tool/code-dispatch"), "Code Mode dispatch was not audited")

const finalized = await new ToolRuntime([guardedTool]).run({ id: "finalized", name: "guarded", arguments: {}, order: 1 })
assert((finalized.output as Record<string, unknown>).secret === "[redacted]", "definition finalizer did not run")
assert(Object.isFrozen(finalized.output), "finalized result must be frozen")

console.log("L06 tests: ok")
