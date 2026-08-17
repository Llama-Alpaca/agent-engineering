import { assert, type TraceEvent } from "../../common/trace.ts"
import { expected as fixture } from "./fixtures/expected.ts"
import {
  AgentSpine,
  PythonSdkFacade,
  durableSignature,
  protocolStdoutIsPure,
  runAcp,
  runBuiltArtifactSmoke,
  runEvidenceMatrix,
  runHmrSafety,
  runJsonRpc,
  runSurfacesLab,
  type AgentStack,
} from "../code.ts"

const stack: AgentStack = {
  name: "test-stack",
  version: "test",
  plugins: ["course-capability-stack"],
}

const request = { requestId: "test-001", input: "inspect" }
const headless = new AgentSpine(stack).handle(request)
assert(headless.response.status === "ok", "stack should execute a normal request")
assert(headless.events.some((event) => event.type === "response.completed"), "completion must be durable")

const trace: TraceEvent[] = []
const rpc = runJsonRpc(stack, { jsonrpc: "2.0", id: "1", method: "agent/run", params: request }, trace)
assert(protocolStdoutIsPure(rpc), "JSON-RPC stdout must contain protocol JSON only")
assert(JSON.parse(rpc.protocolStdout[0]).jsonrpc === "2.0", "JSON-RPC envelope is preserved")

const sdk = new PythonSdkFacade(stack).run("inspect", "test-001")
assert(durableSignature(sdk.durableEvents) === durableSignature(headless.events), "SDK and headless share the core transcript")

const needsApproval = runAcp(stack, { ...request, permission: "ask" })
assert(needsApproval.response.status === "permission_required", "ACP ask must pause without approval")
const denied = runAcp(stack, { ...request, permission: "ask", approval: false })
assert(denied.response.status === "denied", "ACP denial remains distinct from a pending approval")
const cancelled = runAcp(stack, { ...request, permission: "allow", cancelBeforeTool: true })
assert(cancelled.response.status === "cancelled", "ACP cancel must be visible")

const hmr = runHmrSafety(stack)
assert(hmr.firstInstall === 2 && hmr.reloadInstall === 2 && hmr.afterFirstDispose === 1 && hmr.afterDispose === 0 && hmr.ownerIsolation, "HMR must not leak or cross-delete registrations")
assert(runBuiltArtifactSmoke(stack, { entrypoint: "dist/headless.js", version: "test", plugins: [] }).status === "fail", "negative built-artifact control must fail")
assert(runBuiltArtifactSmoke(stack, { entrypoint: "dist/headless.js", version: "test", plugins: stack.plugins }).status === "pass", "complete artifact smoke must pass")

const lab = runSurfacesLab()
assert(lab.sameDurableCore, "all product surfaces must share durable core events")
assert(lab.protocolPure, "all protocol surfaces must keep stdout pure")
assert(lab.evidence.find((row) => row.kind === "course-composition")?.status === "pass", "course stack composes offline")
assert(lab.evidence.find((row) => row.kind === "real-composition")?.status === "skip", "upstream Loader composition is not overclaimed")
assert(lab.evidence.find((row) => row.kind === "real-api-smoke")?.status === "skip", "keyless API smoke must skip explicitly")
assert(lab.evidence.find((row) => row.kind === "built-artifact-smoke")?.status === "pass", "complete built artifact passes smoke")
assert(lab.negativeBuiltArtifact.status === "fail", "lab retains mock-green/published-entry negative control")
assert(lab.snapshot === fixture.snapshot, "keyless transcript matches committed fixture")
assert(JSON.stringify([lab.headless.surface, lab.jsonrpc.surface, lab.pythonSdk.surface]) === JSON.stringify(fixture.surfaces), "surface fixture matches")
assert(lab.evidence.find((row) => row.kind === "real-composition")?.status === fixture.realComposition, "real-composition fixture matches")
assert(lab.evidence.find((row) => row.kind === "real-api-smoke")?.status === fixture.realApi, "real-API fixture matches")
const missing = new AgentSpine({ ...stack, plugins: [] }).handle(request)
assert(missing.response.status === "error", "missing built capability must fail closed")

console.log("10_surfaces_testing tests: ok")
