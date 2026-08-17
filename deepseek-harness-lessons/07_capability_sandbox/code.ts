import { posix as posixPath } from "node:path"
import { assert, deepClone, printResult, type TraceEvent } from "../common/trace.ts"

export interface CapabilityDefinition<T> {
  readonly id: string
  readonly version: string
  readonly describe: string
  readonly validate: (value: unknown) => value is T
}

export interface CapabilityProvider<T> {
  readonly name: string
  readonly provide: (scope: CapabilityScope) => T
  readonly dispose?: () => void
}

export interface CapabilityConsumer<T, Result> {
  readonly name: string
  readonly consume: (capability: T, input: string) => Promise<Result> | Result
}

export class CapabilityError extends Error {
  readonly code: string
  readonly auditTarget?: string

  constructor(code: string, message: string, auditTarget?: string) {
    super(message)
    this.name = "CapabilityError"
    this.code = code
    this.auditTarget = auditTarget
  }
}

export type Action = "read" | "write" | "shell"
export type Decision = "allow" | "ask" | "deny"

export interface AuditEntry {
  readonly realm: string
  readonly action: Action | "scope"
  readonly target: string
  readonly decision: Decision | "disposed" | "provided"
  readonly provider?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function inside(root: string, candidate: string): boolean {
  if (root === "/") return candidate.startsWith("/")
  return candidate === root || candidate.startsWith(`${root}/`)
}

/** Policy is deliberately independent from a provider or a model-facing consumer. */
export class SandboxPolicy {
  readonly root: string
  readonly mode: "workspace-write"
  private readonly oneShotApprovals = new Set<string>()
  private readonly audit: (entry: AuditEntry) => void

  constructor(root: string, audit: (entry: AuditEntry) => void) {
    this.root = posixPath.normalize(root)
    this.mode = "workspace-write"
    this.audit = audit
  }

  resolvePath(relativePath: string): string {
    if (relativePath.includes("\0")) throw new CapabilityError("PATH_ESCAPE", "NUL is not a valid path", relativePath)
    const candidate = posixPath.resolve(this.root, relativePath)
    if (!inside(this.root, candidate)) throw new CapabilityError("PATH_ESCAPE", `path escapes workspace: ${relativePath}`, relativePath)
    return candidate
  }

  approveOnce(action: Action, target: string): void {
    const normalized = action === "read" || action === "write" ? this.resolvePath(target) : target.trim()
    this.oneShotApprovals.add(`${action}:${normalized}`)
    this.audit({ realm: "policy", action, target: normalized, decision: "ask" })
  }

  check(action: Action, target: string): Decision {
    if (action === "read" || action === "write") {
      let absolute: string
      try {
        absolute = this.resolvePath(target)
      } catch (error) {
        this.audit({ realm: "policy", action, target, decision: "deny" })
        throw error
      }
      if (action === "read") {
        this.audit({ realm: "policy", action, target: absolute, decision: "allow" })
        return "allow"
      }
      const key = `${action}:${absolute}`
      if (this.oneShotApprovals.delete(key)) {
        this.audit({ realm: "policy", action, target: absolute, decision: "allow" })
        return "allow"
      }
      this.audit({ realm: "policy", action, target: absolute, decision: "ask" })
      return "ask"
    }
    const normalized = target.trim()
    if (normalized === "pwd" || normalized.startsWith("cat ")) {
      this.audit({ realm: "policy", action, target: normalized, decision: "allow" })
      return "allow"
    }
    this.audit({ realm: "policy", action, target: normalized, decision: "deny" })
    return "deny"
  }
}

export interface Evidence {
  readonly provider: string
  readonly path: string
  readonly content: string
}

export interface EvidenceReader {
  readonly read: (path: string) => Promise<Evidence>
}

export interface FileSystemCapability {
  readonly read: (path: string) => Promise<string>
  readonly write: (path: string, content: string) => Promise<void>
}

export interface ShellCapability {
  readonly run: (command: string) => Promise<{ command: string; output: string }>
}

export class ExecutionWorld implements FileSystemCapability, ShellCapability {
  readonly realm: string
  readonly policy: SandboxPolicy
  readonly files = new Map<string, string>()
  private disposed = false
  private readonly audit: (entry: AuditEntry) => void

  constructor(
    realm: string,
    policy: SandboxPolicy,
    initialFiles: Readonly<Record<string, string>>,
    audit: (entry: AuditEntry) => void,
  ) {
    this.realm = realm
    this.policy = policy
    this.audit = audit
    for (const [path, content] of Object.entries(initialFiles)) this.files.set(policy.resolvePath(path), content)
  }

  async read(path: string): Promise<string> {
    this.ensureLive()
    const absolute = this.check("read", path)
    const content = this.files.get(absolute)
    if (content === undefined) throw new CapabilityError("NOT_FOUND", `file not found: ${path}`, path)
    return content
  }

  async write(path: string, content: string): Promise<void> {
    this.ensureLive()
    const absolute = this.policy.resolvePath(path)
    const decision = this.policy.check("write", path)
    if (decision === "ask") {
      this.audit({ realm: this.realm, action: "write", target: absolute, decision: "ask" })
      throw new CapabilityError("APPROVAL_REQUIRED", `approval required for ${path}`, path)
    }
    if (decision !== "allow") {
      this.audit({ realm: this.realm, action: "write", target: absolute, decision: "deny" })
      throw new CapabilityError("POLICY_DENIED", `write denied for ${path}`, path)
    }
    this.files.set(absolute, content)
    this.audit({ realm: this.realm, action: "write", target: absolute, decision: "allow" })
  }

  async run(command: string): Promise<{ command: string; output: string }> {
    this.ensureLive()
    const decision = this.policy.check("shell", command)
    if (decision !== "allow") throw new CapabilityError("SHELL_DENIED", `shell command denied: ${command}`, command)
    if (command === "pwd") return { command, output: this.policy.root }
    const relative = command.slice("cat ".length).trim()
    return { command, output: await this.read(relative) }
  }

  dispose(): void {
    this.disposed = true
    this.files.clear()
    this.audit({ realm: this.realm, action: "scope", target: this.realm, decision: "disposed" })
  }

  private check(action: Action, path: string): string {
    const absolute = this.policy.resolvePath(path)
    const decision = this.policy.check(action, path)
    if (decision !== "allow") throw new CapabilityError("POLICY_DENIED", `${action} denied for ${path}`, path)
    return absolute
  }

  private ensureLive(): void {
    if (this.disposed) throw new CapabilityError("SCOPE_DISPOSED", `realm ${this.realm} is disposed`)
  }
}

export const WORLD: CapabilityDefinition<ExecutionWorld> = {
  id: "execution-world",
  version: "1",
  describe: "filesystem and shell in one execution world",
  validate: (value): value is ExecutionWorld => value instanceof ExecutionWorld,
}

export const FILE_SYSTEM: CapabilityDefinition<FileSystemCapability> = {
  id: "file-system",
  version: "1",
  describe: "workspace-scoped file read/write",
  validate: (value): value is FileSystemCapability => isRecord(value) && typeof value.read === "function" && typeof value.write === "function",
}

export const SHELL: CapabilityDefinition<ShellCapability> = {
  id: "shell",
  version: "1",
  describe: "workspace-scoped command execution",
  validate: (value): value is ShellCapability => isRecord(value) && typeof value.run === "function",
}

export const EVIDENCE: CapabilityDefinition<EvidenceReader> = {
  id: "evidence-reader",
  version: "1",
  describe: "model-facing evidence reader",
  validate: (value): value is EvidenceReader => isRecord(value) && typeof value.read === "function",
}

export class CapabilityScope {
  readonly id: string
  readonly audit: AuditEntry[]
  private readonly providers = new Map<string, CapabilityProvider<unknown>>()
  private readonly instances = new Map<string, unknown>()
  private disposed = false

  constructor(id: string, audit: AuditEntry[]) {
    this.id = id
    this.audit = audit
  }

  register<T>(definition: CapabilityDefinition<T>, provider: CapabilityProvider<T>): void {
    this.ensureLive()
    assert(!this.providers.has(definition.id), `duplicate provider for ${definition.id}`)
    this.providers.set(definition.id, provider as CapabilityProvider<unknown>)
  }

  resolve<T>(definition: CapabilityDefinition<T>): T {
    this.ensureLive()
    const existing = this.instances.get(definition.id)
    if (existing !== undefined) {
      assert(definition.validate(existing), `provider returned invalid ${definition.id}`)
      return existing
    }
    const provider = this.providers.get(definition.id)
    if (!provider) throw new CapabilityError("MISSING_PROVIDER", `no provider for ${definition.id}`)
    const value = provider.provide(this)
    assert(definition.validate(value), `provider ${provider.name} returned invalid ${definition.id}`)
    this.instances.set(definition.id, value)
    this.audit.push({ realm: this.id, action: "scope", target: definition.id, decision: "provided", provider: provider.name })
    return value
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const provider of [...this.providers.values()].reverse()) provider.dispose?.()
    this.instances.clear()
    this.providers.clear()
    this.audit.push({ realm: this.id, action: "scope", target: this.id, decision: "disposed" })
  }

  private ensureLive(): void {
    if (this.disposed) throw new CapabilityError("SCOPE_DISPOSED", `scope ${this.id} is disposed`)
  }
}

class WorldProvider implements CapabilityProvider<ExecutionWorld> {
  readonly name = "local-world"
  private readonly world: ExecutionWorld
  constructor(world: ExecutionWorld) {
    this.world = world
  }
  provide(): ExecutionWorld {
    return this.world
  }
  dispose(): void {
    this.world.dispose()
  }
}

class LocalEvidenceProvider implements CapabilityProvider<EvidenceReader> {
  readonly name = "local-evidence"
  provide(scope: CapabilityScope): EvidenceReader {
    const world = scope.resolve(WORLD)
    return {
      read: async (path) => ({ provider: this.name, path, content: await world.read(path) }),
    }
  }
}

class RemoteEvidenceProvider implements CapabilityProvider<EvidenceReader> {
  readonly name = "fake-remote-evidence"
  private readonly records: Readonly<Record<string, string>>
  private disposed = false
  constructor(records: Readonly<Record<string, string>>) {
    this.records = records
  }
  provide(): EvidenceReader {
    return {
      read: async (path) => {
        if (this.disposed) throw new CapabilityError("SCOPE_DISPOSED", "remote evidence scope is disposed", path)
        const content = this.records[path]
        if (content === undefined) throw new CapabilityError("REMOTE_NOT_FOUND", `remote evidence missing: ${path}`, path)
        return { provider: this.name, path, content }
      },
    }
  }

  dispose(): void {
    this.disposed = true
  }
}

class ProjectionProvider<T> implements CapabilityProvider<T> {
  readonly name: string
  private readonly select: (world: ExecutionWorld) => T
  constructor(name: string, _definition: CapabilityDefinition<T>, select: (world: ExecutionWorld) => T) {
    this.name = name
    this.select = select
  }
  provide(scope: CapabilityScope): T {
    const world = scope.resolve(WORLD)
    return this.select(world)
  }
}

export class EvidenceConsumer implements CapabilityConsumer<EvidenceReader, Evidence> {
  readonly name = "model-evidence-consumer"
  async consume(reader: EvidenceReader, input: string): Promise<Evidence> {
    return reader.read(input)
  }
}

export interface Realm {
  readonly id: string
  readonly scope: CapabilityScope
  readonly consumer: EvidenceConsumer
  readonly audit: AuditEntry[]
}

export function createRealm(options: {
  readonly id: string
  readonly provider: "local" | "remote"
  readonly root: string
  readonly files: Readonly<Record<string, string>>
  readonly remoteRecords?: Readonly<Record<string, string>>
}): Realm {
  const audit: AuditEntry[] = []
  const trace = (entry: AuditEntry): void => {
    audit.push(entry)
  }
  const policy = new SandboxPolicy(options.root, trace)
  const world = new ExecutionWorld(options.id, policy, options.files, trace)
  const scope = new CapabilityScope(options.id, audit)
  scope.register(WORLD, new WorldProvider(world))
  scope.register(FILE_SYSTEM, new ProjectionProvider("world-filesystem", FILE_SYSTEM, (value) => value))
  scope.register(SHELL, new ProjectionProvider("world-shell", SHELL, (value) => value))
  if (options.provider === "local") scope.register(EVIDENCE, new LocalEvidenceProvider())
  else scope.register(EVIDENCE, new RemoteEvidenceProvider(options.remoteRecords ?? {}))
  return { id: options.id, scope, consumer: new EvidenceConsumer(), audit }
}

export interface LessonFacts {
  readonly providerSwap: {
    consumerName: string
    localProvider: string
    remoteProvider: string
    localContent: string
    remoteContent: string
    consumerBranchCount: number
  }
  readonly sharedWorld: { sameIdentity: boolean; fileContent: string; shellOutput: string }
  readonly sandbox: {
    escapeCode: string
    approvalCode: string
    retryWorked: boolean
    secondWriteCode: string
    shellDeniedCode: string
    auditDecisions: readonly string[]
  }
  readonly disposal: { code: string; remoteCode: string; disposedAudit: boolean }
}

export async function runLesson(): Promise<LessonFacts> {
  const local = createRealm({
    id: "agent-local",
    provider: "local",
    root: "/course/local",
    files: { "notes.txt": "local evidence", "README.md": "same world" },
  })
  const remote = createRealm({
    id: "agent-remote",
    provider: "remote",
    root: "/course/remote",
    files: { "notes.txt": "remote workspace is private" },
    remoteRecords: { "notes.txt": "remote provider evidence" },
  })
  const localEvidence = await local.consumer.consume(local.scope.resolve(EVIDENCE), "notes.txt")
  const remoteEvidence = await remote.consumer.consume(remote.scope.resolve(EVIDENCE), "notes.txt")
  assert(localEvidence.provider === "local-evidence", "local provider not selected")
  assert(remoteEvidence.provider === "fake-remote-evidence", "remote provider not selected")

  const localWorld = local.scope.resolve(WORLD)
  const localFs = local.scope.resolve(FILE_SYSTEM)
  const localShell = local.scope.resolve(SHELL)
  assert(localFs === localWorld && localShell === localWorld, "FS and shell must share execution world")
  const shellPwd = await localShell.run("pwd")
  const sharedContent = await localFs.read("README.md")

  let escapeCode = ""
  try {
    await localFs.read("../secret.txt")
  } catch (error) {
    escapeCode = error instanceof CapabilityError ? error.code : String(error)
  }
  assert(escapeCode === "PATH_ESCAPE", "workspace escape must fail closed")

  let approvalCode = ""
  let retryWorked = false
  try {
    await localFs.write("notes/new.txt", "draft")
  } catch (error) {
    approvalCode = error instanceof CapabilityError ? error.code : String(error)
  }
  assert(approvalCode === "APPROVAL_REQUIRED", "workspace write should require approval")
  localWorld.policy.approveOnce("write", "notes/new.txt")
  await localFs.write("notes/new.txt", "approved once")
  retryWorked = (await localFs.read("notes/new.txt")) === "approved once"
  let secondWriteCode = ""
  try {
    await localFs.write("notes/new.txt", "second attempt")
  } catch (error) {
    secondWriteCode = error instanceof CapabilityError ? error.code : String(error)
  }
  assert(secondWriteCode === "APPROVAL_REQUIRED", "one-shot approval must be consumed")

  let shellDeniedCode = ""
  try {
    await localShell.run("rm -rf /")
  } catch (error) {
    shellDeniedCode = error instanceof CapabilityError ? error.code : String(error)
  }
  assert(shellDeniedCode === "SHELL_DENIED", "unsafe shell must be denied")

  const providerDecisions = local.audit
    .filter((entry) => entry.action === "read" || entry.action === "write" || entry.action === "shell")
    .map((entry) => `${entry.action}:${entry.decision}`)
  const resolvedRemote = remote.scope.resolve(EVIDENCE)
  remote.scope.dispose()
  let remoteDisposalCode = ""
  try {
    await remote.consumer.consume(resolvedRemote, "notes.txt")
  } catch (error) {
    remoteDisposalCode = error instanceof CapabilityError ? error.code : String(error)
  }
  assert(remoteDisposalCode === "SCOPE_DISPOSED", "resolved remote capability must be revoked on scope dispose")

  local.scope.dispose()
  let disposalCode = ""
  try {
    await local.consumer.consume(local.scope.resolve(EVIDENCE), "notes.txt")
  } catch (error) {
    disposalCode = error instanceof CapabilityError ? error.code : String(error)
  }
  assert(disposalCode === "SCOPE_DISPOSED", "disposed scope must reject consumers")
  const disposedAudit = local.audit.some((entry) => entry.decision === "disposed")

  const facts: LessonFacts = {
    providerSwap: {
      consumerName: local.consumer.name,
      localProvider: localEvidence.provider,
      remoteProvider: remoteEvidence.provider,
      localContent: localEvidence.content,
      remoteContent: remoteEvidence.content,
      consumerBranchCount: 0,
    },
    sharedWorld: { sameIdentity: localFs === localWorld && localShell === localWorld, fileContent: sharedContent, shellOutput: shellPwd.output },
    sandbox: { escapeCode, approvalCode, retryWorked, secondWriteCode, shellDeniedCode, auditDecisions: [...providerDecisions] },
    disposal: { code: disposalCode, remoteCode: remoteDisposalCode, disposedAudit },
  }
  const events: TraceEvent[] = [
    { type: "provider/resolve", data: { local: localEvidence.provider, remote: remoteEvidence.provider, consumer: local.consumer.name } },
    { type: "world/share", data: { sameIdentity: facts.sharedWorld.sameIdentity, shell: shellPwd.output } },
    { type: "sandbox/deny", data: { escapeCode, shellDeniedCode } },
    { type: "sandbox/approval", data: { approvalCode, retryWorked, secondWriteCode } },
    { type: "scope/dispose", data: { code: disposalCode, remoteCode: remoteDisposalCode, disposedAudit } },
  ]
  printResult("07_capability_sandbox", { ...facts }, events)
  return facts
}

if (process.argv[1]?.endsWith("code.ts")) void runLesson()
