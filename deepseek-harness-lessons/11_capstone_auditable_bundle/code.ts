import { assert, deepClone, printResult, type JsonValue, type TraceEvent } from "../common/trace.ts"

export type ProviderKind = "local" | "fake-remote"
export type PolicyDecision = "allow" | "ask" | "deny"

export interface EvidenceRecord {
  readonly path: string
  readonly line: number
  readonly claim: string
  readonly locator: string
  readonly provider: ProviderKind
}

export interface EvidenceProvider {
  readonly kind: ProviderKind
  inspect(path: string, query?: string): EvidenceRecord[]
}

const REPOSITORY: Readonly<Record<string, readonly string[]>> = {
  "src/agent-loop.ts": [
    "export function runTurn(input: string) {",
    "  // FACT: the core loop is unchanged by the evidence bundle",
    "  return dispatch(input)",
    "}",
  ],
  "packages/evidence/index.ts": [
    "export const repo_evidence = defineTool()",
    "  // FACT: every claim carries a source locator",
  ],
  "README.md": [
    "# Auditable repository bundle",
    "// FACT: observe before modify",
  ],
}

function normalizePath(path: string, root = "/workspace/repo"): string {
  const absolute = path.startsWith("/") ? path : `${root}/${path}`
  const parts: string[] = []
  for (const part of absolute.split("/")) {
    if (!part || part === ".") continue
    if (part === "..") parts.pop()
    else parts.push(part)
  }
  return `/${parts.join("/")}`
}

function relativePath(path: string, root = "/workspace/repo"): string {
  const normalized = normalizePath(path, root)
  return normalized.startsWith(`${root}/`) ? normalized.slice(root.length + 1) : normalized.slice(1)
}

export class LocalEvidenceProvider implements EvidenceProvider {
  readonly kind: ProviderKind = "local"

  inspect(path: string, query?: string): EvidenceRecord[] {
    const relative = relativePath(path)
    const lines = REPOSITORY[relative]
    if (!lines) return []
    return lines
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => !query || line.toLowerCase().includes(query.toLowerCase()))
      .map(({ line, index }) => ({
        path: relative,
        line: index + 1,
        claim: line,
        locator: `file:///workspace/repo/${relative}#L${index + 1}`,
        provider: this.kind,
      }))
  }
}

/** A deterministic stand-in for an HTTP/evidence service. */
export class FakeRemoteEvidenceProvider implements EvidenceProvider {
  readonly kind: ProviderKind = "fake-remote"
  private readonly local = new LocalEvidenceProvider()

  inspect(path: string, query?: string): EvidenceRecord[] {
    return this.local.inspect(path, query).map((record) => ({
      ...record,
      locator: `remote://evidence.snapshot/${record.path}#L${record.line}`,
      provider: this.kind,
    }))
  }
}

export class EvidenceCapabilityDefinition {
  readonly id = "evidence"
  readonly providers: readonly ProviderKind[] = ["local", "fake-remote"]

  createProvider(kind: ProviderKind): EvidenceProvider {
    if (kind === "local") return new LocalEvidenceProvider()
    return new FakeRemoteEvidenceProvider()
  }
}

export const repoEvidenceTool = {
  name: "repo_evidence",
  description: "Read repository evidence and return claims with source locators.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "workspace-relative repository path" },
      query: { type: "string", description: "optional case-insensitive line filter" },
    },
    required: ["path"],
    additionalProperties: false,
  },
  outputSchema: {
    type: "object",
    properties: {
      ok: { type: "boolean" },
      provider: { type: "string", enum: ["local", "fake-remote"] },
      records: {
        type: "array",
        items: {
          type: "object",
          properties: {
            path: { type: "string" },
            line: { type: "integer", minimum: 1 },
            claim: { type: "string" },
            locator: { type: "string" },
            provider: { type: "string", enum: ["local", "fake-remote"] },
          },
          required: ["path", "line", "claim", "locator", "provider"],
          additionalProperties: false,
        },
      },
      locators: { type: "array", items: { type: "string" } },
      error: { type: "string" },
    },
    required: ["ok", "provider", "records", "locators"],
    additionalProperties: false,
  },
} as const

export interface AuditEvent {
  readonly sequence: number
  readonly type: string
  readonly data: Record<string, JsonValue>
}

export interface AuditProjection {
  readonly observedPaths: readonly string[]
  readonly modifiedPaths: readonly string[]
  readonly deniedActions: readonly string[]
  readonly pendingApprovals: readonly string[]
  readonly approvedApprovals: readonly string[]
  readonly providers: readonly ProviderKind[]
  readonly subagentReports: readonly string[]
  readonly modelMessageCount: number
}

export class AuditLog {
  readonly events: AuditEvent[] = []
  private nextSequence = 1

  append(type: string, data: Record<string, JsonValue> = {}): AuditEvent {
    const event: AuditEvent = { sequence: this.nextSequence++, type, data: { ...data } }
    this.events.push(event)
    return event
  }

  snapshot(): AuditEvent[] {
    return deepClone(this.events)
  }

  restore(events: readonly AuditEvent[]): void {
    this.events.length = 0
    this.events.push(...deepClone(events))
    this.nextSequence = (this.events.at(-1)?.sequence ?? 0) + 1
  }

  toTraceEvents(): TraceEvent[] {
    return this.events.map((event) => ({
      type: `audit/${event.type}`,
      data: { sequence: event.sequence, ...event.data },
    }))
  }

  projection(): AuditProjection {
    const observed = new Set<string>()
    const modified = new Set<string>()
    const denied: string[] = []
    const pending = new Set<string>()
    const approved = new Set<string>()
    const providers = new Set<ProviderKind>()
    const reports: string[] = []
    let modelMessageCount = 0
    for (const event of this.events) {
      const path = event.data.path
      if (event.type === "evidence.observed" && typeof path === "string") observed.add(path)
      if (event.type === "repo.modified" && typeof path === "string") modified.add(path)
      if (event.type === "policy.denied") denied.push(String(event.data.reason ?? "unknown"))
      if (event.type === "policy.ask" && typeof event.data.requestId === "string") pending.add(event.data.requestId)
      if (event.type === "policy.approved" && typeof event.data.requestId === "string") {
        pending.delete(event.data.requestId)
        approved.add(event.data.requestId)
      }
      if (event.type === "repo.modified" && typeof event.data.approvalId === "string") approved.delete(event.data.approvalId)
      if (event.type === "provider.selected" && (event.data.provider === "local" || event.data.provider === "fake-remote")) {
        providers.add(event.data.provider)
      }
      if (event.type === "subagent.report" && typeof event.data.workerId === "string") reports.push(event.data.workerId)
      if (event.type === "model.message") modelMessageCount += 1
    }
    return {
      observedPaths: [...observed].sort(),
      modifiedPaths: [...modified].sort(),
      deniedActions: denied,
      pendingApprovals: [...pending].sort(),
      approvedApprovals: [...approved].sort(),
      providers: [...providers].sort(),
      subagentReports: reports,
      modelMessageCount,
    }
  }
}

export class WorkspacePolicy {
  readonly root = "/workspace/repo"
  private readonly observed = new Set<string>()
  private readonly pendingApprovals = new Map<string, ApprovalBinding>()
  private readonly approved = new Map<string, ApprovalBinding>()

  isInside(path: string): boolean {
    const normalized = normalizePath(path, this.root)
    return normalized === this.root || normalized.startsWith(`${this.root}/`)
  }

  markObserved(path: string): void {
    if (this.isInside(path)) this.observed.add(normalizePath(path, this.root))
  }

  hasObserved(path: string): boolean {
    return this.observed.has(normalizePath(path, this.root))
  }

  evaluateModify(path: string, content: string, dangerous: boolean, approvalId?: string): PolicyEvaluation {
    const normalized = normalizePath(path, this.root)
    if (!this.isInside(normalized)) return { decision: "deny", reason: "path is outside workspace" }
    if (!this.hasObserved(normalized)) return { decision: "deny", reason: "observe evidence before modifying" }
    if (!dangerous && approvalId) return { decision: "deny", reason: "approval id is only valid for a dangerous action" }
    if (!dangerous) return { decision: "allow" }
    if (!approvalId) return { decision: "ask" }
    const grant = this.approved.get(approvalId)
    if (!grant) return { decision: "deny", reason: "unknown or unapproved request id" }
    if (grant.action !== "modify" || grant.path !== normalized || grant.content !== content) {
      return { decision: "deny", reason: "approval does not match action, path, and content" }
    }
    this.approved.delete(approvalId)
    return { decision: "allow" }
  }

  requestApproval(requestId: string, path: string, content: string): ApprovalBinding {
    assert(!this.pendingApprovals.has(requestId) && !this.approved.has(requestId), `duplicate approval request: ${requestId}`)
    const binding: ApprovalBinding = { requestId, action: "modify", path: normalizePath(path, this.root), content }
    this.pendingApprovals.set(requestId, binding)
    return binding
  }

  approve(requestId: string): ApprovalBinding {
    const binding = this.pendingApprovals.get(requestId)
    assert(binding !== undefined, `unknown approval request: ${requestId}`)
    this.pendingApprovals.delete(requestId)
    this.approved.set(requestId, binding)
    return binding
  }

  restore(events: readonly AuditEvent[]): void {
    this.observed.clear()
    this.pendingApprovals.clear()
    this.approved.clear()
    for (const event of events) {
      if (event.type === "evidence.observed" && typeof event.data.path === "string") {
        this.markObserved(event.data.path)
      }
      if (
        event.type === "policy.ask" &&
        typeof event.data.requestId === "string" &&
        event.data.action === "modify" &&
        typeof event.data.path === "string" &&
        typeof event.data.content === "string"
      ) {
        this.pendingApprovals.set(event.data.requestId, {
          requestId: event.data.requestId,
          action: "modify",
          path: normalizePath(event.data.path, this.root),
          content: event.data.content,
        })
      }
      if (
        event.type === "policy.approved" &&
        typeof event.data.requestId === "string" &&
        event.data.action === "modify" &&
        typeof event.data.path === "string" &&
        typeof event.data.content === "string"
      ) {
        const binding: ApprovalBinding = {
          requestId: event.data.requestId,
          action: "modify",
          path: normalizePath(event.data.path, this.root),
          content: event.data.content,
        }
        this.pendingApprovals.delete(binding.requestId)
        this.approved.set(binding.requestId, binding)
      }
      if (event.type === "repo.modified" && typeof event.data.approvalId === "string") {
        this.approved.delete(event.data.approvalId)
      }
    }
  }
}

export interface ApprovalBinding {
  readonly requestId: string
  readonly action: "modify"
  readonly path: string
  readonly content: string
}

export interface PolicyEvaluation {
  readonly decision: PolicyDecision
  readonly reason?: string
}

export interface EvidenceOutput {
  readonly ok: boolean
  readonly provider: ProviderKind
  readonly records: readonly EvidenceRecord[]
  readonly locators: readonly string[]
  readonly error?: string
}

export class RepoEvidenceTool {
  readonly definition = repoEvidenceTool
  private readonly providerRef: () => EvidenceProvider
  private readonly policy: WorkspacePolicy
  private readonly audit: AuditLog

  constructor(providerRef: () => EvidenceProvider, policy: WorkspacePolicy, audit: AuditLog) {
    this.providerRef = providerRef
    this.policy = policy
    this.audit = audit
  }

  inspect(input: { path: string; query?: string }): EvidenceOutput {
    assert(typeof input.path === "string" && input.path.length > 0, "repo_evidence.path is required")
    const absolute = normalizePath(input.path, this.policy.root)
    const provider = this.providerRef()
    if (!this.policy.isInside(absolute)) {
      const reason = "path is outside workspace"
      this.audit.append("policy.denied", { action: "observe", path: absolute, reason })
      return { ok: false, provider: provider.kind, records: [], locators: [], error: reason }
    }
    const records = provider.inspect(absolute, input.query)
    const locators = records.map((record) => record.locator)
    if (records.length === 0) {
      const reason = "no evidence found"
      this.audit.append("evidence.empty", { path: absolute, provider: provider.kind, reason })
      return { ok: false, provider: provider.kind, records, locators, error: reason }
    }
    this.policy.markObserved(absolute)
    this.audit.append("evidence.observed", {
      path: absolute,
      provider: provider.kind,
      records: records.length,
      locators,
    })
    return { ok: true, provider: provider.kind, records, locators }
  }
}

export interface ContextConfig {
  readonly spillThresholdChars: number
  readonly compactionBudgetTokens: number
}

export interface ContextView {
  readonly canonicalChars: number
  readonly modelVisibleChars: number
  readonly modelVisibleTokens: number
  readonly locator?: string
  readonly compactionCount: number
  readonly view: string
}

export class ContextManager {
  readonly config: ContextConfig
  private readonly spillValues = new Map<string, string>()
  private nextLocator = 1
  private readonly audit: AuditLog

  constructor(config: ContextConfig, audit: AuditLog) {
    assert(config.spillThresholdChars > 0, "spill threshold must be positive")
    assert(config.compactionBudgetTokens > 0, "compaction budget must be positive")
    this.config = config
    this.audit = audit
    for (const event of audit.events) {
      if (event.type !== "context.spilled") continue
      if (typeof event.data.locator !== "string" || typeof event.data.canonical !== "string") continue
      this.spillValues.set(event.data.locator, event.data.canonical)
      const match = /spill:\/\/bundle\/(\d+)$/.exec(event.data.locator)
      if (match) this.nextLocator = Math.max(this.nextLocator, Number(match[1]) + 1)
    }
  }

  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4)
  }

  project(canonical: string): ContextView {
    let view = canonical
    let locator: string | undefined
    // A result that would otherwise need compaction is spilled first, so a
    // checkpoint never becomes the only copy of the canonical value.
    if (canonical.length > this.config.spillThresholdChars || this.estimateTokens(canonical) > this.config.compactionBudgetTokens) {
      locator = `spill://bundle/${this.nextLocator++}`
      this.spillValues.set(locator, canonical)
      const facts = [...canonical.matchAll(/FACT:[^\n]+/g)].map((match) => match[0]).join("\n")
      view = `[${locator}]\n${facts}\n(retrieve canonical evidence by locator)`
      this.audit.append("context.spilled", {
        locator,
        canonical,
        canonicalChars: canonical.length,
        viewChars: view.length,
      })
    }
    let compactionCount = 0
    if (this.estimateTokens(view) > this.config.compactionBudgetTokens) {
      const beforeChars = view.length
      const facts = [...view.matchAll(/FACT:[^\n]+/g)].map((match) => match[0])
      const header = locator ? `[checkpoint ${locator}]` : "[checkpoint]"
      view = [header, ...facts].join("\n")
      assert(!locator || view.includes(locator), "compaction must retain spill locator")
      assert(this.estimateTokens(view) <= this.config.compactionBudgetTokens, "facts and locator cannot fit compaction budget")
      compactionCount = 1
      this.audit.append("context.compacted", {
        beforeChars,
        afterChars: view.length,
        preservedFacts: facts.length,
      })
    }
    return {
      canonicalChars: canonical.length,
      modelVisibleChars: view.length,
      modelVisibleTokens: this.estimateTokens(view),
      locator,
      compactionCount,
      view,
    }
  }

  read(locator: string): string | undefined {
    return this.spillValues.get(locator)
  }
}

export interface ModelMessage {
  readonly role: "user" | "tool" | "assistant"
  readonly content: string
}

export interface PersistedSession {
  readonly audit: readonly AuditEvent[]
  readonly modelHistory: readonly ModelMessage[]
}

export class DurableSession {
  readonly audit: AuditLog
  readonly modelHistory: ModelMessage[]

  constructor(audit = new AuditLog(), modelHistory: ModelMessage[] = []) {
    this.audit = audit
    this.modelHistory = modelHistory
  }

  addModelMessage(role: ModelMessage["role"], content: string): void {
    const message = { role, content }
    this.modelHistory.push(message)
    this.audit.append("model.message", { role, content })
  }

  snapshot(): PersistedSession {
    return { audit: this.audit.snapshot(), modelHistory: deepClone(this.modelHistory) }
  }

  serialize(): string {
    return JSON.stringify(this.snapshot())
  }

  static resume(serialized: string | PersistedSession): DurableSession {
    const saved = typeof serialized === "string" ? (JSON.parse(serialized) as PersistedSession) : serialized
    const audit = new AuditLog()
    audit.restore(saved.audit)
    const rebuilt = saved.audit
      .filter((event) => event.type === "model.message")
      .map((event) => ({ role: event.data.role as ModelMessage["role"], content: String(event.data.content) }))
    assert(JSON.stringify(rebuilt) === JSON.stringify(saved.modelHistory), "model history disagrees with durable audit")
    return new DurableSession(audit, deepClone([...saved.modelHistory]))
  }
}

export interface ModifyResult {
  readonly decision: PolicyDecision
  readonly path: string
  readonly requestId?: string
  readonly reason?: string
}

export interface SubagentReviewReport {
  readonly workerId: string
  readonly mode: "fresh"
  readonly readonly: true
  readonly paths: readonly string[]
  readonly findings: readonly string[]
  readonly status: "succeeded" | "failed"
}

export class BundleRegistry {
  private readonly names = new Set<string>()

  register(name: string): void {
    this.names.add(name)
  }

  unregister(name: string): void {
    this.names.delete(name)
  }

  get size(): number {
    return this.names.size
  }
}

export interface BundleConfig {
  readonly provider?: ProviderKind
  readonly context?: ContextConfig
}

export class AuditableBundle {
  readonly definition = new EvidenceCapabilityDefinition()
  readonly policy = new WorkspacePolicy()
  readonly audit: AuditLog
  readonly session: DurableSession
  readonly registry = new BundleRegistry()
  readonly context: ContextManager
  readonly tool: RepoEvidenceTool
  readonly coreAgentLoopCommit = "unchanged-in-course-capstone"
  private provider: EvidenceProvider
  private readonly providers: Record<ProviderKind, EvidenceProvider>
  private nextApproval = 1

  constructor(config: BundleConfig = {}, session = new DurableSession()) {
    this.audit = session.audit
    this.session = session
    this.providers = {
      local: this.definition.createProvider("local"),
      "fake-remote": this.definition.createProvider("fake-remote"),
    }
    const previousProviderEvent = [...this.audit.events]
      .reverse()
      .find((event) => event.type === "provider.selected" && (event.data.provider === "local" || event.data.provider === "fake-remote"))
    const previousProvider = previousProviderEvent?.data.provider as ProviderKind | undefined
    const selectedProvider = config.provider ?? previousProvider ?? "local"
    this.provider = this.providers[selectedProvider]
    const previousApprovalNumbers = this.audit.events
      .map((event) => (typeof event.data.requestId === "string" ? /^approval-(\d+)$/.exec(event.data.requestId) : null))
      .filter((match): match is RegExpExecArray => match !== null)
      .map((match) => Number(match[1]))
    this.nextApproval = Math.max(0, ...previousApprovalNumbers) + 1
    this.context = new ContextManager(
      config.context ?? { spillThresholdChars: 180, compactionBudgetTokens: 24 },
      this.audit,
    )
    this.policy.restore(this.audit.events)
    this.tool = new RepoEvidenceTool(() => this.provider, this.policy, this.audit)
    if (previousProvider !== selectedProvider) this.audit.append("provider.selected", { provider: this.provider.kind })
  }

  install(): void {
    this.registry.register("capability:evidence")
    this.registry.register("tool:repo_evidence")
    this.registry.register("projection:audit")
    this.audit.append("bundle.installed", { registrations: this.registry.size })
  }

  uninstall(): void {
    this.registry.unregister("capability:evidence")
    this.registry.unregister("tool:repo_evidence")
    this.registry.unregister("projection:audit")
    this.audit.append("bundle.uninstalled", { registrations: this.registry.size })
  }

  selectProvider(kind: ProviderKind): void {
    this.provider = this.providers[kind]
    this.audit.append("provider.selected", { provider: kind })
  }

  get providerKind(): ProviderKind {
    return this.provider.kind
  }

  get coreAgentLoopTouched(): boolean {
    return this.audit.events.some((event) => {
      const path = event.data.path
      return (
        event.type === "repo.modified" &&
        typeof path === "string" &&
        (path === "/workspace/repo/packages/core/agent-loop" || path.startsWith("/workspace/repo/packages/core/agent-loop/"))
      )
    })
  }

  headless(path: string, query?: string): EvidenceOutput & { surface: "headless"; context: ContextView } {
    this.audit.append("surface.request", { surface: "headless", path })
    this.session.addModelMessage("user", `evidence ${path}`)
    const output = this.tool.inspect({ path, query })
    const canonical = output.records.map((record) => `${record.path}:${record.line} ${record.claim}`).join("\n")
    const context = this.context.project(canonical || `FACT: no records for ${path}`)
    this.session.addModelMessage("tool", context.view)
    this.audit.append("surface.completed", { surface: "headless", path, ok: output.ok })
    return { ...output, surface: "headless", context }
  }

  pythonSdk(path: string, query?: string): EvidenceOutput & { surface: "python-sdk"; context: ContextView } {
    this.audit.append("surface.request", { surface: "python-sdk", path })
    this.session.addModelMessage("user", `evidence ${path}`)
    const output = this.tool.inspect({ path, query })
    const canonical = output.records.map((record) => `${record.path}:${record.line} ${record.claim}`).join("\n")
    const context = this.context.project(canonical || `FACT: no records for ${path}`)
    this.session.addModelMessage("tool", context.view)
    this.audit.append("surface.completed", { surface: "python-sdk", path, ok: output.ok })
    return { ...output, surface: "python-sdk", context }
  }

  modify(path: string, content: string, options: { dangerous?: boolean; approvalId?: string } = {}): ModifyResult {
    const absolute = normalizePath(path, this.policy.root)
    const dangerous = options.dangerous ?? false
    const evaluation = this.policy.evaluateModify(absolute, content, dangerous, options.approvalId)
    const decision = evaluation.decision
    if (decision === "deny") {
      const reason = evaluation.reason ?? "policy denied action"
      this.audit.append("policy.denied", { action: "modify", path: absolute, reason })
      return { decision, path: absolute, reason }
    }
    if (decision === "ask") {
      const requestId = `approval-${String(this.nextApproval++).padStart(3, "0")}`
      const binding = this.policy.requestApproval(requestId, absolute, content)
      this.audit.append("policy.ask", { action: binding.action, path: binding.path, content: binding.content, requestId })
      return { decision, path: absolute, requestId, reason: "dangerous action requires approval" }
    }
    const data: Record<string, JsonValue> = { path: absolute, content, dangerous }
    if (dangerous && options.approvalId) data.approvalId = options.approvalId
    this.audit.append("repo.modified", data)
    return { decision: "allow", path: absolute }
  }

  approve(requestId: string): void {
    let binding: ApprovalBinding
    try {
      binding = this.policy.approve(requestId)
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      this.audit.append("policy.denied", { action: "approve", requestId, reason })
      throw error
    }
    this.audit.append("policy.approved", {
      requestId: binding.requestId,
      action: binding.action,
      path: binding.path,
      content: binding.content,
    })
  }

  runFreshReadOnlyReview(paths: readonly string[]): SubagentReviewReport[] {
    const reports: SubagentReviewReport[] = []
    const workers = [...paths].sort().map((path, index) => {
      const workerId = `review-child-${String(index + 1).padStart(2, "0")}`
      this.audit.append("subagent.spawned", { workerId, mode: "fresh", parentId: "capstone-parent" })
      return { workerId, path }
    })
    this.audit.append("subagent.barrier", { workers: workers.map((worker) => worker.workerId) })
    for (const { workerId, path } of workers) {
      const childPolicy = new WorkspacePolicy()
      const childAudit = new AuditLog()
      const childTool = new RepoEvidenceTool(() => this.provider, childPolicy, childAudit)
      const output = childTool.inspect({ path })
      const findings = output.records.map((record) => `${record.claim} @ ${record.locator}`)
      const report: SubagentReviewReport = {
        workerId,
        mode: "fresh",
        readonly: true,
        paths: [path],
        findings,
        status: output.ok ? "succeeded" : "failed",
      }
      reports.push(report)
      this.audit.append("subagent.report", {
        workerId,
        status: report.status,
        findings,
        readonly: true,
        childEvents: childAudit.events.length,
      })
    }
    this.audit.append("subagent.joined", { workers: workers.length, reports: reports.length })
    return reports
  }

  projection(): AuditProjection {
    return this.audit.projection()
  }

  durableTrace(): TraceEvent[] {
    return this.audit.toTraceEvents()
  }
}

export interface CapstoneLabResult {
  readonly localHeadless: ReturnType<AuditableBundle["headless"]>
  readonly remoteSdk: ReturnType<AuditableBundle["pythonSdk"]>
  readonly unobservedModify: ModifyResult
  readonly dangerousAsk: ModifyResult
  readonly dangerousApproved: ModifyResult
  readonly outsideModify: ModifyResult
  readonly reviewReports: readonly SubagentReviewReport[]
  readonly providerSwapConsumerUnchanged: boolean
  readonly context: ContextView
  readonly contextCanonicalIntact: boolean
  readonly contextResumeIntact: boolean
  readonly projectionBeforeResume: AuditProjection
  readonly projectionAfterResume: AuditProjection
  readonly resumeConsistent: boolean
  readonly registrationsBeforeUninstall: number
  readonly registrationsAfterUninstall: number
  readonly coreAgentLoopTouched: boolean
  readonly evidenceMatrix: readonly Record<string, JsonValue>[]
  readonly snapshot: string
  readonly events: readonly TraceEvent[]
}

export function runCapstoneLab(): CapstoneLabResult {
  const bundle = new AuditableBundle()
  bundle.install()
  const schemaBefore = JSON.stringify(bundle.tool.definition)
  const localHeadless = bundle.headless("src/agent-loop.ts")
  const unobservedModify = bundle.modify("src/new-file.ts", "new content")
  const dangerousAsk = bundle.modify("src/agent-loop.ts", "rm -rf", { dangerous: true })
  assert(dangerousAsk.requestId !== undefined, "dangerous policy must issue approval id")
  bundle.approve(dangerousAsk.requestId)
  const dangerousApproved = bundle.modify("src/agent-loop.ts", "rm -rf", {
    dangerous: true,
    approvalId: dangerousAsk.requestId,
  })
  const outsideModify = bundle.modify("../secrets.txt", "should fail")
  bundle.selectProvider("fake-remote")
  const remoteSdk = bundle.pythonSdk("src/agent-loop.ts")
  const schemaAfter = JSON.stringify(bundle.tool.definition)
  const reviewReports = bundle.runFreshReadOnlyReview(["README.md", "packages/evidence/index.ts"])
  const longCanonical = [
    "diagnostic=" + "x".repeat(500),
    "FACT: observe first",
    "FACT: deny outside",
    "FACT: swap by config",
  ].join("\n")
  const context = bundle.context.project(longCanonical)
  const contextCanonicalIntact = context.locator !== undefined && bundle.context.read(context.locator) === longCanonical
  const projectionBeforeResume = bundle.projection()
  const serialized = bundle.session.serialize()
  const resumedSession = DurableSession.resume(serialized)
  const projectionAfterResume = resumedSession.audit.projection()
  const resumedContextBundle = new AuditableBundle({}, resumedSession)
  const contextResumeIntact = context.locator !== undefined && resumedContextBundle.context.read(context.locator) === longCanonical
  const resumeConsistent =
    JSON.stringify(projectionBeforeResume) === JSON.stringify(projectionAfterResume) &&
    JSON.stringify(bundle.audit.events) === JSON.stringify(resumedSession.audit.events) &&
    JSON.stringify(bundle.session.modelHistory) === JSON.stringify(resumedSession.modelHistory)
  const registrationsBeforeUninstall = bundle.registry.size
  bundle.uninstall()
  const registrationsAfterUninstall = bundle.registry.size
  const snapshot = bundle
    .durableTrace()
    .map((event) => `${event.type}:${JSON.stringify(event.data)}`)
    .join("\n")
  const schemaInvariant =
    repoEvidenceTool.inputSchema.required.includes("path") &&
    repoEvidenceTool.outputSchema.required.includes("locators") &&
    repoEvidenceTool.outputSchema.properties.records.items.required.includes("locator")
  const policyInvariant =
    unobservedModify.decision === "deny" &&
    dangerousAsk.decision === "ask" &&
    dangerousApproved.decision === "allow" &&
    outsideModify.decision === "deny"
  const evidenceMatrix: Record<string, JsonValue>[] = [
    { kind: "unit", status: schemaInvariant && policyInvariant ? "pass" : "fail", proves: "policy and schema invariants", limitation: "local process only" },
    { kind: "hmr-safety", status: registrationsAfterUninstall === 0 ? "pass" : "fail", proves: "bundle registrations unload", limitation: "in-memory registry" },
    { kind: "persistence-replay", status: resumeConsistent && contextResumeIntact ? "pass" : "fail", proves: "audit, model history, and spilled canonical evidence resume consistently", limitation: "no crash-injection filesystem" },
    { kind: "course-composition", status: localHeadless.ok && remoteSdk.ok ? "pass" : "fail", proves: "definition/provider/tool/policy/session compose in the offline course stack", limitation: "does not load upstream packages" },
    { kind: "real-composition", status: "skip", proves: "upstream Loader composition is not claimed by this simulation", limitation: "requires isolated fixed-SHA checkout and upstream dependencies" },
    { kind: "keyless-snapshot", status: snapshot.length > 0 ? "pass" : "fail", proves: "produces a durable trace for fixture comparison", limitation: "determinism is established by the test's independent double-run and SHA fixture; this row alone only checks non-empty output" },
    { kind: "real-api-smoke", status: "skip", proves: "optional boundary is explicit", limitation: "requires separately authorized key" },
  ]
  return {
    localHeadless,
    remoteSdk,
    unobservedModify,
    dangerousAsk,
    dangerousApproved,
    outsideModify,
    reviewReports,
    providerSwapConsumerUnchanged: schemaBefore === schemaAfter,
    context,
    contextCanonicalIntact,
    contextResumeIntact,
    projectionBeforeResume,
    projectionAfterResume,
    resumeConsistent,
    registrationsBeforeUninstall,
    registrationsAfterUninstall,
    coreAgentLoopTouched: bundle.coreAgentLoopTouched,
    evidenceMatrix,
    snapshot,
    events: bundle.durableTrace(),
  }
}

export function main(): void {
  const result = runCapstoneLab()
  printResult(
    "11_capstone_auditable_bundle",
    {
      tool: {
        name: repoEvidenceTool.name,
        inputSchema: repoEvidenceTool.inputSchema,
        outputSchema: repoEvidenceTool.outputSchema,
      },
      localHeadless: {
        provider: result.localHeadless.provider,
        locators: result.localHeadless.locators,
        context: result.localHeadless.context,
      },
      remoteSdk: {
        provider: result.remoteSdk.provider,
        locators: result.remoteSdk.locators,
        context: result.remoteSdk.context,
      },
      policy: {
        unobservedModify: result.unobservedModify,
        dangerousAsk: result.dangerousAsk,
        dangerousApproved: result.dangerousApproved,
        outsideModify: result.outsideModify,
      },
      reviewReports: result.reviewReports,
      providerSwapConsumerUnchanged: result.providerSwapConsumerUnchanged,
      context: result.context,
      contextCanonicalIntact: result.contextCanonicalIntact,
      contextResumeIntact: result.contextResumeIntact,
      projectionBeforeResume: result.projectionBeforeResume,
      projectionAfterResume: result.projectionAfterResume,
      resumeConsistent: result.resumeConsistent,
      registrationsBeforeUninstall: result.registrationsBeforeUninstall,
      registrationsAfterUninstall: result.registrationsAfterUninstall,
      coreAgentLoopTouched: result.coreAgentLoopTouched,
      evidenceMatrix: result.evidenceMatrix,
      snapshot: result.snapshot,
    },
    result.events,
  )
}

if (process.argv[1]?.endsWith("/11_capstone_auditable_bundle/code.ts")) main()
