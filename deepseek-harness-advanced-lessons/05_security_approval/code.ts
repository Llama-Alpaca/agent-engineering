/**
 * L05 - turn-enclosed approval audit, permission presets, and sandbox evidence.
 *
 * `allowed-once` is the only grant. Every request appends a matching
 * approval/asked + approval/decided pair inside an open turn. Permission
 * presets bundle two independent durable knobs; a policy claim is kept
 * separate from evidence that a native runner actually confined execution.
 */

import { assert, deepClone, printResult, type JsonValue } from "../../deepseek-harness-lessons/common/trace.ts"

export type ApprovalPolicy = "ask" | "never"
export type ApprovalOutcome = "allowed-once" | "rejected" | "cancelled" | "unavailable"
export type SandboxMode = "read-only" | "workspace-write" | "danger-full-access"

export type SecurityEvent =
  | { readonly type: "turn/start"; readonly data: { readonly turn: number } }
  | { readonly type: "turn/end"; readonly data: { readonly turn: number } }
  | { readonly type: "approval/asked"; readonly data: { readonly id: string; readonly toolName: string; readonly callId?: string; readonly reason?: string } }
  | { readonly type: "approval/decided"; readonly data: { readonly id: string; readonly outcome: ApprovalOutcome } }
  | { readonly type: "approval/policy"; readonly data: { readonly policy: ApprovalPolicy } }
  | { readonly type: "sandbox/mode"; readonly data: { readonly mode: SandboxMode } }
  | { readonly type: "permission/preset"; readonly data: { readonly preset: string } }

export type StoredSecurityEvent = SecurityEvent & { readonly seq: number }

export class SessionLog {
  readonly events: StoredSecurityEvent[] = []

  append(event: SecurityEvent): StoredSecurityEvent {
    const stored = { ...deepClone(event), seq: this.events.length } as StoredSecurityEvent
    this.events.push(stored)
    return deepClone(stored)
  }

  hasOpenTurn(): boolean {
    for (let index = this.events.length - 1; index >= 0; index -= 1) {
      const type = this.events[index]?.type
      if (type === "turn/start") return true
      if (type === "turn/end") return false
    }
    return false
  }
}

export interface ApprovalRequest {
  readonly toolName: string
  readonly callId?: string
  readonly reason?: string
  readonly signal?: AbortSignal
}

export type ApprovalAnswerer = (request: ApprovalRequest) => unknown | Promise<unknown>

const OUTCOMES: readonly ApprovalOutcome[] = ["allowed-once", "rejected", "cancelled", "unavailable"]

export function effectiveApprovalPolicy(events: readonly SecurityEvent[]): ApprovalPolicy | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type === "approval/policy") return event.data.policy
  }
  return undefined
}

export class ApprovalService {
  private readonly session: SessionLog
  private readonly defaultPolicy: ApprovalPolicy
  private readonly answerer: ApprovalAnswerer | undefined
  private nextId = 0

  constructor(session: SessionLog, options: { readonly policy?: ApprovalPolicy; readonly answerer?: ApprovalAnswerer } = {}) {
    this.session = session
    this.defaultPolicy = options.policy ?? "ask"
    this.answerer = options.answerer
  }

  get policy(): ApprovalPolicy {
    return effectiveApprovalPolicy(this.session.events) ?? this.defaultPolicy
  }

  setPolicy(policy: ApprovalPolicy): void {
    if (this.policy === policy) return
    this.session.append({ type: "approval/policy", data: { policy } })
  }

  async request(request: ApprovalRequest): Promise<ApprovalOutcome> {
    assert(this.session.hasOpenTurn(), "approval request must be enclosed by an open turn")
    const id = `approval-${this.nextId++}`
    this.session.append({
      type: "approval/asked",
      data: {
        id,
        toolName: request.toolName,
        ...(request.callId === undefined ? {} : { callId: request.callId }),
        ...(request.reason === undefined ? {} : { reason: request.reason }),
      },
    })
    const outcome = await this.decide(request)
    this.session.append({ type: "approval/decided", data: { id, outcome } })
    return outcome
  }

  private async decide(request: ApprovalRequest): Promise<ApprovalOutcome> {
    if (request.signal?.aborted) return "cancelled"
    if (this.policy === "never") return "rejected"
    if (this.answerer === undefined) return "unavailable"
    try {
      const answer = await this.answerer(request)
      if (request.signal?.aborted) return "cancelled"
      return OUTCOMES.includes(answer as ApprovalOutcome) ? answer as ApprovalOutcome : "unavailable"
    } catch {
      return "unavailable"
    }
  }
}

export interface PermissionPreset {
  readonly sandbox: SandboxMode
  readonly approval: ApprovalPolicy
}

export function effectiveSandboxMode(events: readonly SecurityEvent[]): SandboxMode | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type === "sandbox/mode") return event.data.mode
  }
  return undefined
}

export class PermissionPresetService {
  private readonly session: SessionLog
  private readonly approval: ApprovalService
  private readonly presets: Readonly<Record<string, PermissionPreset>>
  readonly defaultSandbox: SandboxMode

  constructor(session: SessionLog, approval: ApprovalService, options: { readonly defaultSandbox?: SandboxMode; readonly presets?: Readonly<Record<string, PermissionPreset>> } = {}) {
    this.session = session
    this.approval = approval
    this.defaultSandbox = options.defaultSandbox ?? "workspace-write"
    this.presets = options.presets ?? {
      "workspace-write": { sandbox: "workspace-write", approval: "ask" },
      "danger-full-access": { sandbox: "danger-full-access", approval: "never" },
    }
  }

  current(): string {
    const sandbox = effectiveSandboxMode(this.session.events) ?? this.defaultSandbox
    const approval = this.approval.policy
    for (const [name, preset] of Object.entries(this.presets)) {
      if (preset.sandbox === sandbox && preset.approval === approval) return name
    }
    return "custom"
  }

  set(name: string): void {
    const preset = this.presets[name]
    assert(preset !== undefined, `unknown permission preset ${name}`)
    if (this.current() !== name) this.session.append({ type: "permission/preset", data: { preset: name } })
    if ((effectiveSandboxMode(this.session.events) ?? this.defaultSandbox) !== preset.sandbox) {
      this.session.append({ type: "sandbox/mode", data: { mode: preset.sandbox } })
    }
    this.approval.setPolicy(preset.approval)
  }
}

export type Enforcement = "full" | "partial"

export interface SandboxEvidence {
  readonly platform: "linux" | "darwin" | "win32" | "other"
  readonly runner?: "bwrap" | "landlock" | "seatbelt" | "windows-acl"
  readonly probe: "passed" | "failed" | "not-run"
  readonly enforcement?: Enforcement
  readonly confined: boolean
  readonly reason: string
}

/** Selection evidence, not actual OS confinement. A missing runner fails closed. */
export function evaluateSandboxEvidence(options: {
  readonly platform: SandboxEvidence["platform"]
  readonly available: readonly string[]
  readonly probe?: Readonly<Record<string, boolean>>
}): SandboxEvidence {
  const probe = options.probe ?? {}
  if (options.platform === "linux") {
    if (options.available.includes("bwrap") && probe.bwrap === true) return { platform: "linux", runner: "bwrap", probe: "passed", enforcement: "full", confined: true, reason: "functional profile probe passed" }
    if (options.available.includes("landlock") && probe.landlock === true) return { platform: "linux", runner: "landlock", probe: "passed", enforcement: "partial", confined: true, reason: "fallback probe passed with ABI-dependent coverage" }
    return { platform: "linux", probe: "failed", confined: false, reason: "no usable confining runner; refuse execution" }
  }
  if (options.platform === "darwin" && options.available.includes("seatbelt")) {
    return { platform: "darwin", runner: "seatbelt", probe: "not-run", enforcement: "full", confined: true, reason: "single platform runner selected" }
  }
  if (options.platform === "win32" && options.available.includes("windows-acl")) {
    return { platform: "win32", runner: "windows-acl", probe: "not-run", enforcement: "partial", confined: true, reason: "restricted-token/ACL boundary has documented hard-link limits" }
  }
  return { platform: options.platform, probe: "failed", confined: false, reason: "platform has no configured sandbox chain" }
}

function evidenceToJson(evidence: SandboxEvidence): Record<string, JsonValue> {
  return {
    platform: evidence.platform,
    runner: evidence.runner ?? null,
    probe: evidence.probe,
    enforcement: evidence.enforcement ?? null,
    confined: evidence.confined,
    reason: evidence.reason,
  }
}

/** Replays the pair invariant that protects loaded and newly appended logs. */
export function validateApprovalAudit(events: readonly StoredSecurityEvent[]): readonly string[] {
  const errors: string[] = []
  const pending = new Set<string>()
  let open = false
  for (const event of events) {
    if (event.type === "turn/start") open = true
    if (event.type === "turn/end") {
      if (pending.size > 0) errors.push("turn ended with an unmatched approval question")
      open = false
    }
    if (event.type === "approval/asked") {
      if (!open) errors.push(`approval ${event.data.id} asked outside a turn`)
      if (pending.has(event.data.id)) errors.push(`approval ${event.data.id} repeated`)
      pending.add(event.data.id)
    }
    if (event.type === "approval/decided") {
      if (!open || !pending.delete(event.data.id)) errors.push(`approval ${event.data.id} decided without a matching ask`)
    }
  }
  return errors
}

export async function runSecurityLab(): Promise<Record<string, JsonValue>> {
  const session = new SessionLog()
  const approval = new ApprovalService(session, { answerer: () => "allowed-once" })
  const permissions = new PermissionPresetService(session, approval)
  session.append({ type: "turn/start", data: { turn: 1 } })
  const allowed = await approval.request({ toolName: "workspace.write", callId: "call-1", reason: "update the course" })
  session.append({ type: "turn/end", data: { turn: 1 } })
  permissions.set("danger-full-access")
  session.append({ type: "turn/start", data: { turn: 2 } })
  const rejected = await approval.request({ toolName: "shell.exec", callId: "call-2" })
  session.append({ type: "turn/end", data: { turn: 2 } })

  const unavailableSession = new SessionLog()
  unavailableSession.append({ type: "turn/start", data: { turn: 1 } })
  const unavailable = await new ApprovalService(unavailableSession).request({ toolName: "network.fetch" })

  return {
    allowed,
    rejected,
    unavailable,
    auditErrors: validateApprovalAudit(session.events),
    auditTypes: session.events.map((event) => event.type),
    currentPreset: permissions.current(),
    linux: evidenceToJson(evaluateSandboxEvidence({ platform: "linux", available: ["bwrap", "landlock"], probe: { bwrap: false, landlock: true } })),
    windows: evidenceToJson(evaluateSandboxEvidence({ platform: "win32", available: ["windows-acl"] })),
    unavailableSandbox: evidenceToJson(evaluateSandboxEvidence({ platform: "other", available: [] })),
  }
}

export async function runLesson(): Promise<void> {
  const facts = await runSecurityLab()
  assert(facts.allowed === "allowed-once" && facts.rejected === "rejected" && facts.unavailable === "unavailable", "approval policy failed closed incorrectly")
  assert((facts.auditErrors as JsonValue[]).length === 0, "approval audit pairs are unbalanced")
  assert((facts.unavailableSandbox as Record<string, JsonValue>).confined === false, "missing native sandbox claimed confinement")
  printResult("advanced-05-approval-sandbox-evidence", facts)
}

const entry = process.argv[1] ?? ""
if (entry.endsWith("/05_security_approval/code.ts") || entry.endsWith("\\05_security_approval\\code.ts")) await runLesson()
