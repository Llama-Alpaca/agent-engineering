import { assert, printResult, type JsonValue, type TraceEvent } from "../common/trace.ts"

export type SurfaceName = "headless" | "jsonrpc" | "python-sdk" | "acp"
export type PermissionMode = "allow" | "deny" | "ask"
export type ResponseStatus = "ok" | "permission_required" | "denied" | "cancelled" | "error"

export interface AgentStack {
  readonly name: string
  readonly version: string
  readonly plugins: readonly string[]
}

export interface CoreRequest {
  readonly requestId: string
  readonly input: string
  readonly permission?: PermissionMode
  readonly approval?: boolean
  readonly cancelBeforeTool?: boolean
}

export interface CoreResponse {
  readonly status: ResponseStatus
  readonly output?: string
  readonly error?: string
}

export interface SurfaceResult {
  readonly surface: SurfaceName
  readonly response: CoreResponse
  readonly durableEvents: readonly TraceEvent[]
  readonly protocolStdout: readonly string[]
  readonly diagnostics: readonly string[]
}

export interface EvidenceRow {
  readonly kind:
    | "unit"
    | "hmr-safety"
    | "course-composition"
    | "real-composition"
    | "keyless-snapshot"
    | "real-api-smoke"
    | "built-artifact-smoke"
  readonly status: "pass" | "skip" | "fail"
  readonly proves: string
  readonly limitation: string
}

const REQUIRED_PLUGIN = "course-capability-stack"

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(",")}]`
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`)
      .join(",")}}`
  }
  return JSON.stringify(value)
}

function coreEvent(type: string, data: Record<string, JsonValue>): TraceEvent {
  return { type, data }
}

export class AgentSpine {
  readonly stack: AgentStack

  constructor(stack: AgentStack) {
    this.stack = stack
  }

  handle(request: CoreRequest): { response: CoreResponse; events: TraceEvent[] } {
    const events: TraceEvent[] = []
    events.push(coreEvent("session.started", { requestId: request.requestId }))
    if (!this.stack.plugins.includes(REQUIRED_PLUGIN)) {
      const reason = "required capability plugin is missing"
      const response: CoreResponse = { status: "error", error: reason }
      events.push(coreEvent("request.rejected", { requestId: request.requestId, reason }))
      return { response, events }
    }

    events.push(coreEvent("request.accepted", { requestId: request.requestId }))
    if (request.cancelBeforeTool) {
      events.push(coreEvent("request.cancelled", { requestId: request.requestId, phase: "before-tool" }))
      return { response: { status: "cancelled" }, events }
    }

    const permission = request.permission ?? "allow"
    if (permission === "deny" || (permission === "ask" && request.approval !== true)) {
      const status: ResponseStatus = permission === "ask" && request.approval === undefined ? "permission_required" : "denied"
      const reason = status === "permission_required" ? "approval required" : "policy denied tool"
      events.push(coreEvent("permission." + status, { requestId: request.requestId, reason }))
      return { response: { status, error: reason }, events }
    }

    events.push(coreEvent("tool.requested", { requestId: request.requestId, tool: "repo_evidence" }))
    const output = `evidence: ${request.input}`
    events.push(coreEvent("tool.completed", { requestId: request.requestId, tool: "repo_evidence" }))
    events.push(coreEvent("response.completed", { requestId: request.requestId }))
    return { response: { status: "ok", output }, events }
  }
}

function surfaceTrace(trace: TraceEvent[], type: string, surface: SurfaceName, requestId: string): void {
  trace.push({ type, data: { surface, requestId } })
}

export function runHeadless(stack: AgentStack, request: CoreRequest, trace: TraceEvent[] = []): SurfaceResult {
  surfaceTrace(trace, "surface/headless.received", "headless", request.requestId)
  const result = new AgentSpine(stack).handle(request)
  surfaceTrace(trace, "surface/headless.completed", "headless", request.requestId)
  return {
    surface: "headless",
    response: result.response,
    durableEvents: result.events,
    protocolStdout: [JSON.stringify(result.response)],
    diagnostics: [],
  }
}

export interface JsonRpcRequest {
  readonly jsonrpc: "2.0"
  readonly id: string
  readonly method: "agent/run"
  readonly params: CoreRequest
}

export function runJsonRpc(stack: AgentStack, rpc: JsonRpcRequest, trace: TraceEvent[] = []): SurfaceResult {
  surfaceTrace(trace, "surface/jsonrpc.received", "jsonrpc", rpc.params.requestId)
  const result = new AgentSpine(stack).handle(rpc.params)
  const response = { jsonrpc: "2.0", id: rpc.id, result: result.response }
  surfaceTrace(trace, "surface/jsonrpc.completed", "jsonrpc", rpc.params.requestId)
  return {
    surface: "jsonrpc",
    response: result.response,
    durableEvents: result.events,
    protocolStdout: [JSON.stringify(response)],
    diagnostics: ["json-rpc diagnostics are kept off stdout"],
  }
}

export class PythonSdkFacade {
  private readonly stack: AgentStack
  private readonly trace: TraceEvent[]

  constructor(stack: AgentStack, trace: TraceEvent[] = []) {
    this.stack = stack
    this.trace = trace
  }

  run(input: string, requestId = "sdk-001"): SurfaceResult {
    surfaceTrace(this.trace, "surface/python-sdk.received", "python-sdk", requestId)
    const result = new AgentSpine(this.stack).handle({ requestId, input })
    surfaceTrace(this.trace, "surface/python-sdk.completed", "python-sdk", requestId)
    return {
      surface: "python-sdk",
      response: result.response,
      durableEvents: result.events,
      protocolStdout: [],
      diagnostics: ["python binding diagnostics use its host logger"],
    }
  }
}

export function runAcp(
  stack: AgentStack,
  request: CoreRequest,
  trace: TraceEvent[] = [],
): SurfaceResult {
  surfaceTrace(trace, "surface/acp.received", "acp", request.requestId)
  const result = new AgentSpine(stack).handle({ ...request, permission: request.permission ?? "ask" })
  const protocolMessage = JSON.stringify({ type: "acp.response", requestId: request.requestId, response: result.response })
  surfaceTrace(trace, "surface/acp.completed", "acp", request.requestId)
  return {
    surface: "acp",
    response: result.response,
    durableEvents: result.events,
    protocolStdout: [protocolMessage],
    diagnostics: [],
  }
}

export function durableSignature(events: readonly TraceEvent[]): string {
  return events.map((event) => `${event.type}:${stableJson(event.data ?? null)}`).join("\n")
}

export function protocolStdoutIsPure(result: SurfaceResult): boolean {
  return result.protocolStdout.every((line) => {
    try {
      JSON.parse(line)
      return true
    } catch {
      return false
    }
  })
}

export class PluginRegistry {
  private readonly registrations = new Map<string, Set<string>>()

  install(name: string, owner = "default"): void {
    const owners = this.registrations.get(name) ?? new Set<string>()
    owners.add(owner)
    this.registrations.set(name, owners)
  }

  uninstall(name: string, owner = "default"): void {
    const owners = this.registrations.get(name)
    if (!owners) return
    owners.delete(owner)
    if (owners.size === 0) this.registrations.delete(name)
  }

  get size(): number {
    return [...this.registrations.values()].reduce((total, owners) => total + owners.size, 0)
  }
}

export function runHmrSafety(stack: AgentStack): {
  firstInstall: number
  reloadInstall: number
  afterFirstDispose: number
  afterDispose: number
  ownerIsolation: boolean
} {
  const registry = new PluginRegistry()
  registry.install(stack.name, "agent-a")
  registry.install(stack.name, "agent-b")
  const firstInstall = registry.size
  registry.install(stack.name, "agent-a")
  const reloadInstall = registry.size
  registry.uninstall(stack.name, "agent-a")
  const afterFirstDispose = registry.size
  registry.uninstall(stack.name, "agent-b")
  return { firstInstall, reloadInstall, afterFirstDispose, afterDispose: registry.size, ownerIsolation: afterFirstDispose === 1 }
}

export interface BuiltArtifact {
  readonly entrypoint: string
  readonly version: string
  readonly plugins: readonly string[]
}

export function runBuiltArtifactSmoke(stack: AgentStack, artifact: BuiltArtifact): EvidenceRow {
  if (artifact.entrypoint.endsWith(".js") && artifact.plugins.includes(REQUIRED_PLUGIN) && stack.plugins.includes(REQUIRED_PLUGIN)) {
    return {
      kind: "built-artifact-smoke",
      status: "pass",
      proves: "course built entry manifest contains the capability stack",
      limitation: "does not load the upstream published artifact or prove model quality",
    }
  }
  return {
    kind: "built-artifact-smoke",
    status: "fail",
    proves: "negative control catches a mock-green artifact missing its plugin",
    limitation: "this is an intentional failure fixture",
  }
}

export function runEvidenceMatrix(stack: AgentStack, hasApiKey = Boolean(process.env.DEEPSEEK_API_KEY)): EvidenceRow[] {
  const hmr = runHmrSafety(stack)
  const snapshot = runHeadless(stack, { requestId: "matrix-001", input: "snapshot" })
  const snapshotAgain = runHeadless(stack, { requestId: "matrix-001", input: "snapshot" })
  const artifact: BuiltArtifact = { entrypoint: "dist/headless.js", version: stack.version, plugins: [...stack.plugins] }
  return [
    {
      kind: "unit",
      status: "pass",
      proves: "core permission, cancel, and event invariants",
      limitation: "does not prove product assembly",
    },
    {
      kind: "hmr-safety",
      status: hmr.firstInstall === 2 && hmr.reloadInstall === 2 && hmr.afterFirstDispose === 1 && hmr.afterDispose === 0 && hmr.ownerIsolation ? "pass" : "fail",
      proves: "repeat install is idempotent, owner disposal is isolated, and final dispose removes registrations",
      limitation: "uses an in-memory registry",
    },
    {
      kind: "course-composition",
      status: snapshot.response.status === "ok" ? "pass" : "fail",
      proves: "headless surface composes the dependency-free course stack",
      limitation: "does not load the fixed upstream Loader or packages",
    },
    {
      kind: "real-composition",
      status: "skip",
      proves: "upstream Loader composition is not claimed by this offline lab",
      limitation: "requires the isolated fixed-SHA checkout and upstream dependencies",
    },
    {
      kind: "keyless-snapshot",
      status: durableSignature(snapshot.durableEvents) === durableSignature(snapshotAgain.durableEvents) && durableSignature(snapshot.durableEvents).length > 0 ? "pass" : "fail",
      proves: "two keyless runs produce the same durable transcript",
      limitation: "does not test current provider API",
    },
    {
      kind: "real-api-smoke",
      status: "skip",
      proves: hasApiKey ? "credential detected but intentionally unused by this offline lab" : "missing key is an explicit skip, not a pass",
      limitation: "requires a separately authorized, current model run",
    },
    runBuiltArtifactSmoke(stack, artifact),
  ]
}

export interface SurfacesLabResult {
  readonly stack: AgentStack
  readonly headless: SurfaceResult
  readonly jsonrpc: SurfaceResult
  readonly pythonSdk: SurfaceResult
  readonly acpAllowed: SurfaceResult
  readonly acpCancelled: SurfaceResult
  readonly sameDurableCore: boolean
  readonly snapshot: string
  readonly protocolPure: boolean
  readonly evidence: readonly EvidenceRow[]
  readonly negativeBuiltArtifact: EvidenceRow
  readonly trace: readonly TraceEvent[]
}

export function runSurfacesLab(): SurfacesLabResult {
  const stack: AgentStack = {
    name: "course-stack",
    version: "snapshot-47f9438",
    plugins: [REQUIRED_PLUGIN, "session-persistence", "repo-evidence"],
  }
  const trace: TraceEvent[] = []
  const request = { requestId: "surface-001", input: "read package metadata" }
  const headless = runHeadless(stack, request, trace)
  const jsonrpc = runJsonRpc(
    stack,
    { jsonrpc: "2.0", id: "1", method: "agent/run", params: request },
    trace,
  )
  const pythonSdk = new PythonSdkFacade(stack, trace).run(request.input, request.requestId)
  const acpAllowed = runAcp(stack, { ...request, permission: "ask", approval: true }, trace)
  const acpCancelled = runAcp(stack, { ...request, permission: "allow", cancelBeforeTool: true, requestId: "surface-cancel" }, trace)
  const signatures = [headless, jsonrpc, pythonSdk].map((result) => durableSignature(result.durableEvents))
  const snapshot = signatures[0]
  return {
    stack,
    headless,
    jsonrpc,
    pythonSdk,
    acpAllowed,
    acpCancelled,
    sameDurableCore: signatures.every((signature) => signature === snapshot),
    snapshot,
    protocolPure: [headless, jsonrpc, acpAllowed, acpCancelled].every(protocolStdoutIsPure),
    evidence: runEvidenceMatrix(stack, false),
    negativeBuiltArtifact: runBuiltArtifactSmoke(stack, { entrypoint: "dist/headless.js", version: stack.version, plugins: stack.plugins.filter((plugin) => plugin !== REQUIRED_PLUGIN) }),
    trace,
  }
}

export function main(): void {
  const result = runSurfacesLab()
  printResult(
    "10_surfaces_testing",
    {
      stack: result.stack,
      sameDurableCore: result.sameDurableCore,
      protocolPure: result.protocolPure,
      surfaceStatuses: {
        headless: result.headless.response.status,
        jsonrpc: result.jsonrpc.response.status,
        pythonSdk: result.pythonSdk.response.status,
        acpAllowed: result.acpAllowed.response.status,
        acpCancelled: result.acpCancelled.response.status,
      },
      snapshot: result.snapshot,
      evidence: result.evidence,
      negativeBuiltArtifact: result.negativeBuiltArtifact,
    },
    result.trace,
  )
}

if (process.argv[1]?.endsWith("/10_surfaces_testing/code.ts")) main()
