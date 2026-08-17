import { assert, deepClone, printResult, type TraceEvent } from "../common/trace.ts"

export type PolicyDecision = "allow" | "ask" | "deny"
export type ToolStatus = "ok" | "error" | "denied" | "cancelled" | "timeout"
export type ToolConcurrency = "safe" | "exclusive"

export interface ToolCall {
  readonly id: string
  readonly name: string
  readonly arguments: unknown
  readonly order: number
  readonly timeoutMs?: number
}

export interface ToolContext {
  readonly call: ToolCall
  readonly signal: AbortSignal
  readonly audit: (event: TraceEvent) => void
}

export interface ToolDefinition<Input = unknown, Output = unknown> {
  readonly name: string
  readonly concurrency: ToolConcurrency
  readonly schema: (value: unknown) => Input
  readonly modelRender: (input: Input) => string
  readonly execute: (input: Input, context: ToolContext) => Output | Promise<Output>
  readonly canonicalize?: (value: Output) => unknown
  readonly finalizeContent?: (value: unknown, context: ToolContext) => unknown
}

/** Existential view used by a registry that stores tools with different schemas. */
export interface RegisteredToolDefinition {
  readonly name: string
  readonly concurrency: ToolConcurrency
  readonly schema: (value: unknown) => unknown
  readonly modelRender: (input: never) => string
  readonly execute: (input: never, context: ToolContext) => unknown | Promise<unknown>
  readonly canonicalize?: (value: never) => unknown
  readonly finalizeContent?: (value: unknown, context: ToolContext) => unknown
}

export interface ToolResult {
  readonly id: string
  readonly name: string
  readonly order: number
  readonly status: ToolStatus
  readonly started: boolean
  readonly output?: unknown
  readonly error?: { readonly code: string; readonly message: string }
}

export type PreExecuteHook = (context: ToolContext, input: unknown) => unknown | Promise<unknown>
export type AroundExecuteHook = (
  context: ToolContext,
  next: (input: unknown) => unknown | Promise<unknown>,
  input: unknown,
) => unknown | Promise<unknown>
export type PostExecuteHook = (context: ToolContext, output: unknown) => unknown | Promise<unknown>
export type ToolGuard = (call: ToolCall, tool: RegisteredToolDefinition, input: unknown) => string | undefined

class ToolError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = "ToolError"
    this.code = code
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!isRecord(value)) return value
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]))
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null) return value
  Object.freeze(value)
  if (Array.isArray(value)) value.forEach((item) => deepFreeze(item))
  else Object.values(value as Record<string, unknown>).forEach((item) => deepFreeze(item))
  return value
}

function schemaObject(fields: Readonly<Record<string, (value: unknown) => boolean>>): (value: unknown) => Record<string, unknown> {
  return (value: unknown) => {
    if (!isRecord(value)) throw new ToolError("SCHEMA", "arguments must be an object")
    for (const [key, check] of Object.entries(fields)) {
      if (!check(value[key])) throw new ToolError("SCHEMA", `invalid or missing argument ${key}`)
    }
    return deepClone(value)
  }
}

export function defineTool<Input, Output>(definition: ToolDefinition<Input, Output>): ToolDefinition<Input, Output> {
  assert(/^[a-z][a-z0-9_]*$/.test(definition.name), `invalid tool name ${definition.name}`)
  return definition
}

export interface ToolRuntimeOptions {
  readonly policy?: (call: ToolCall, tool: RegisteredToolDefinition) => PolicyDecision | Promise<PolicyDecision>
  readonly approve?: (call: ToolCall, tool: RegisteredToolDefinition) => boolean | Promise<boolean>
  readonly preExecute?: readonly PreExecuteHook[]
  readonly aroundExecute?: readonly AroundExecuteHook[]
  readonly postExecute?: readonly PostExecuteHook[]
  readonly guards?: readonly ToolGuard[]
  readonly onStart?: (call: ToolCall) => void
}

export class ToolRuntime {
  private readonly registry = new Map<string, RegisteredToolDefinition>()
  private readonly policy: (call: ToolCall, tool: RegisteredToolDefinition) => PolicyDecision | Promise<PolicyDecision>
  private readonly approve: (call: ToolCall, tool: RegisteredToolDefinition) => boolean | Promise<boolean>
  private readonly preExecute: readonly PreExecuteHook[]
  private readonly aroundExecute: readonly AroundExecuteHook[]
  private readonly postExecute: readonly PostExecuteHook[]
  private readonly guards: readonly ToolGuard[]
  private readonly onStart?: (call: ToolCall) => void
  readonly events: TraceEvent[] = []
  private active = 0
  maxActive = 0

  constructor(definitions: readonly RegisteredToolDefinition[], options: ToolRuntimeOptions = {}) {
    definitions.forEach((definition) => {
      assert(!this.registry.has(definition.name), `duplicate tool ${definition.name}`)
      this.registry.set(definition.name, definition)
    })
    this.policy = options.policy ?? (() => "allow")
    this.approve = options.approve ?? (() => false)
    this.preExecute = options.preExecute ?? []
    this.aroundExecute = options.aroundExecute ?? []
    this.postExecute = options.postExecute ?? []
    this.guards = options.guards ?? []
    this.onStart = options.onStart
  }

  get(name: string): RegisteredToolDefinition | undefined {
    return this.registry.get(name)
  }

  async run(call: ToolCall, signal: AbortSignal = new AbortController().signal): Promise<ToolResult> {
    const tool = this.registry.get(call.name)
    this.events.push({ type: "tool/call", data: { id: call.id, name: call.name, order: call.order } })
    if (!tool) return this.finish(call, "error", false, undefined, { code: "UNKNOWN_TOOL", message: call.name })
    let started = false
    const context: ToolContext = {
      call,
      signal,
      audit: (event) => this.events.push(event),
    }
    try {
      let input = tool.schema(call.arguments)
      const decision = await this.policy(call, tool)
      this.events.push({ type: "tools/policy", data: { id: call.id, decision } })
      if (decision === "deny") {
        return this.finish(call, "denied", false, undefined, { code: "POLICY_DENIED", message: "policy denied tool" })
      }
      if (decision === "ask") {
        const approved = await this.approve(call, tool)
        this.events.push({ type: "tools/approval", data: { id: call.id, approved } })
        if (!approved) {
          return this.finish(call, "denied", false, undefined, { code: "APPROVAL_DENIED", message: "approval rejected tool" })
        }
      }
      if (signal.aborted) return this.finish(call, "cancelled", false, undefined, { code: "ABORTED_BEFORE_START", message: "call was not started" })
      validateTimeout(call.timeoutMs)
      this.events.push({ type: "tools/pre-execute", data: { id: call.id } })
      for (const hook of this.preExecute) input = await hook(context, input)
      if (signal.aborted) return this.finish(call, "cancelled", false, undefined, { code: "ABORTED_BEFORE_START", message: "call was not started" })
      for (const guard of this.guards) {
        const reason = guard(call, tool, input)
        if (reason !== undefined) {
          this.events.push({ type: "tools/guard", data: { id: call.id, decision: "deny", reason } })
          return this.finish(call, "denied", false, undefined, { code: "GUARD_DENIED", message: reason })
        }
      }
      started = true
      this.active += 1
      this.maxActive = Math.max(this.maxActive, this.active)
      this.onStart?.(call)
      this.events.push({ type: "tools/execute", data: { id: call.id, concurrency: tool.concurrency } })
      const execute = this.aroundExecute.reduceRight<(value: unknown) => unknown | Promise<unknown>>(
        (next, hook) => (value) => hook(context, next, value),
        (value) => tool.execute(value as never, context),
      )
      let output: unknown
      try {
        output = await withTimeout(Promise.resolve(execute(input)), call.timeoutMs)
      } catch (error) {
        if (error instanceof ToolError && error.code === "TIMEOUT") {
          return this.finish(call, "timeout", true, undefined, { code: error.code, message: error.message })
        }
        if (signal.aborted) {
          return this.finish(call, "cancelled", true, undefined, { code: "CANCELLED", message: "started call drained after abort" })
        }
        throw error
      }
      if (signal.aborted) return this.finish(call, "cancelled", true, undefined, { code: "CANCELLED", message: "started call drained after abort" })
      this.events.push({ type: "tools/post-execute", data: { id: call.id } })
      for (const hook of this.postExecute) {
        output = await hook(context, output)
        if (signal.aborted) {
          return this.finish(call, "cancelled", true, undefined, { code: "CANCELLED", message: "post-execute cancelled before finalization" })
        }
      }
      let canonical = deepClone(tool.canonicalize ? tool.canonicalize(output as never) : canonicalize(output))
      if (tool.finalizeContent) {
        this.events.push({ type: "tools/finalize-content", data: { id: call.id } })
        canonical = deepClone(tool.finalizeContent(canonical, context))
      }
      return this.finish(call, "ok", true, deepFreeze(canonical))
    } catch (error) {
      const normalized = error instanceof ToolError
        ? { code: error.code, message: error.message }
        : { code: "EXECUTE", message: error instanceof Error ? error.message : String(error) }
      return this.finish(call, "error", started, undefined, normalized)
    } finally {
      if (started) this.active -= 1
    }
  }

  private finish(
    call: ToolCall,
    status: ToolStatus,
    started: boolean,
    output?: unknown,
    error?: { code: string; message: string },
  ): ToolResult {
    const result = deepFreeze({
      id: call.id,
      name: call.name,
      order: call.order,
      status,
      started,
      ...(output !== undefined ? { output } : {}),
      ...(error ? { error } : {}),
    }) as ToolResult
    this.events.push({ type: "tool/result", data: { id: call.id, status, started, ...(error ? { error } : {}) } })
    return result
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs?: number): Promise<T> {
  if (timeoutMs === undefined) return promise
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<symbol>((resolve) => {
    timer = setTimeout(() => resolve(TIMEOUT_SENTINEL), timeoutMs)
  })
  try {
    type TimedResult = { readonly timedOut: false; readonly value: T } | { readonly timedOut: true }
    const result: TimedResult = await Promise.race<TimedResult>([
      promise.then((value) => ({ timedOut: false as const, value })),
      timeout.then(() => ({ timedOut: true as const })),
    ])
    if (result.timedOut) {
      // Drain a started call before publishing its timeout result. A late
      // tool side effect must not race the durable result event.
      await promise.catch(() => undefined)
      throw new ToolError("TIMEOUT", `tool exceeded ${timeoutMs}ms`)
    }
    return result.value
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

function validateTimeout(timeoutMs: number | undefined): void {
  if (timeoutMs !== undefined && (!Number.isInteger(timeoutMs) || timeoutMs < 0)) {
    throw new ToolError("INVALID_TIMEOUT", "timeoutMs must be a non-negative integer")
  }
}

const TIMEOUT_SENTINEL = Symbol("timeout")

function syntheticCancelled(call: ToolCall): ToolResult {
  return deepFreeze({
    id: call.id,
    name: call.name,
    order: call.order,
    status: "cancelled" as const,
    started: false,
    error: { code: "ABORTED_BEFORE_START", message: "scheduler cancelled before dispatch" },
  })
}

export interface ScheduleOutcome {
  readonly results: readonly ToolResult[]
  readonly committedIds: readonly string[]
  readonly dispatchOrder: readonly string[]
  readonly maxActive: number
  readonly events: readonly TraceEvent[]
}

function ensureUnique(calls: readonly ToolCall[]): void {
  const ids = new Set<string>()
  calls.forEach((call) => {
    assert(!ids.has(call.id), `duplicate tool call id ${call.id}`)
    ids.add(call.id)
  })
}

/** Run safe calls together, but make an exclusive call a visible barrier. */
export async function runBatched(runtime: ToolRuntime, calls: readonly ToolCall[], signal?: AbortSignal): Promise<ScheduleOutcome> {
  ensureUnique(calls)
  const dispatchOrder: string[] = []
  const resultMap = new Map<string, ToolResult>()
  const grouped: ToolCall[][] = []
  let safeGroup: ToolCall[] = []
  for (const call of calls) {
    const definition = runtime.get(call.name)
    if (definition?.concurrency === "exclusive") {
      if (safeGroup.length > 0) grouped.push(safeGroup)
      safeGroup = []
      grouped.push([call])
    } else safeGroup.push(call)
  }
  if (safeGroup.length > 0) grouped.push(safeGroup)
  for (const group of grouped) {
    runtime.events.push({ type: "scheduler/group", data: { ids: group.map((call) => call.id), barrier: group.length === 1 && runtime.get(group[0]!.name)?.concurrency === "exclusive" } })
    const running = group.map((call) => {
      dispatchOrder.push(call.id)
      return runtime.run(call, signal)
    })
    const results = await Promise.all(running)
    results.forEach((result) => resultMap.set(result.id, result))
  }
  const results = calls.map((call) => resultMap.get(call.id) ?? syntheticCancelled(call))
  const committedIds = [...results].sort((a, b) => a.order - b.order).map((result) => result.id)
  return { results, committedIds, dispatchOrder, maxActive: runtime.maxActive, events: runtime.events }
}

/** Code Mode sub-calls are transport wrappers; every nested call still uses this runtime. */
export async function runCodeModeSubcalls(
  runtime: ToolRuntime,
  calls: readonly ToolCall[],
  signal?: AbortSignal,
): Promise<ScheduleOutcome> {
  for (const call of calls) {
    runtime.events.push({ type: "tool/code-dispatch", data: { id: call.id, name: call.name } })
  }
  return runBatched(runtime, calls, signal)
}

/** A rolling pool demonstrates synthetic errors for calls never dispatched. */
export async function runRollingPool(
  runtime: ToolRuntime,
  calls: readonly ToolCall[],
  limit: number,
  signal: AbortSignal,
): Promise<ScheduleOutcome> {
  ensureUnique(calls)
  assert(limit >= 1 && Number.isInteger(limit), "pool limit must be positive")
  const dispatchOrder: string[] = []
  const resultMap = new Map<string, ToolResult>()
  let next = 0
  let active = 0
  await new Promise<void>((resolve) => {
    const pump = (): void => {
      while (!signal.aborted && active < limit && next < calls.length) {
        const call = calls[next++]!
        dispatchOrder.push(call.id)
        active += 1
        void runtime.run(call, signal).then((result) => {
          resultMap.set(result.id, result)
          active -= 1
          pump()
        })
      }
      if (signal.aborted) {
        while (next < calls.length) {
          const call = calls[next++]!
          resultMap.set(call.id, syntheticCancelled(call))
          runtime.events.push({ type: "scheduler/synthetic-result", data: { id: call.id, status: "cancelled" } })
        }
      }
      if (next >= calls.length && active === 0) resolve()
    }
    pump()
  })
  const results = calls.map((call) => resultMap.get(call.id) ?? syntheticCancelled(call))
  return {
    results,
    committedIds: [...results].sort((a, b) => a.order - b.order).map((result) => result.id),
    dispatchOrder,
    maxActive: runtime.maxActive,
    events: runtime.events,
  }
}

interface Workspace {
  readonly files: Map<string, string>
}

function createTools(workspace: Workspace): readonly RegisteredToolDefinition[] {
  return [
    defineTool({
      name: "read_file",
      concurrency: "safe",
      schema: schemaObject({ path: (value) => typeof value === "string" }),
      modelRender: (input) => `read ${input.path}`,
      execute: async (input) => {
        await Promise.resolve()
        return { content: workspace.files.get(String(input.path)) ?? "<missing>", path: input.path, secret: "redact-me" }
      },
    }),
    defineTool({
      name: "write_file",
      concurrency: "exclusive",
      schema: schemaObject({ path: (value) => typeof value === "string", content: (value) => typeof value === "string" }),
      modelRender: (input) => `write ${input.path}`,
      execute: async (input) => {
        await Promise.resolve()
        workspace.files.set(String(input.path), String(input.content))
        return { path: input.path, written: true }
      },
    }),
    defineTool({
      name: "shell",
      concurrency: "exclusive",
      schema: schemaObject({ command: (value) => typeof value === "string" }),
      modelRender: (input) => `shell ${input.command}`,
      execute: (input) => ({ command: input.command, exitCode: 0 }),
    }),
    defineTool({
      name: "slow",
      concurrency: "safe",
      schema: schemaObject({ value: (value) => typeof value === "string" }),
      modelRender: (input) => `slow ${input.value}`,
      execute: async (input) => {
        await new Promise((resolve) => setTimeout(resolve, 4))
        return { value: input.value }
      },
    }),
  ]
}

export interface LessonFacts {
  readonly normal: {
    committedIds: readonly string[]
    dispatchOrder: readonly string[]
    maxActive: number
    statuses: readonly ToolStatus[]
    redactedOutput: boolean
    frozenResult: boolean
  }
  readonly denied: { status: ToolStatus; code: string }
  readonly approvalDenied: { status: ToolStatus; code: string }
  readonly schemaFailure: { status: ToolStatus; code: string }
  readonly timeout: { status: ToolStatus; code: string }
  readonly cancelled: {
    dispatchOrder: readonly string[]
    statuses: readonly ToolStatus[]
    syntheticCount: number
    uniqueResultCount: number
  }
}

export async function runLesson(): Promise<LessonFacts> {
  const workspace: Workspace = { files: new Map([["README.md", "event sourcing\n"]]) }
  const started: string[] = []
  const runtime = new ToolRuntime(createTools(workspace), {
    policy: (call) => (call.name === "shell" ? "deny" : call.name === "write_file" ? "ask" : "allow"),
    approve: (call) => call.id === "write-1",
    onStart: (call) => started.push(call.id),
    postExecute: [
      (context, output) => {
        context.audit({ type: "audit/redact", data: { id: context.call.id } })
        if (isRecord(output) && "secret" in output) {
          const copy = { ...output }
          delete copy.secret
          return copy
        }
        return output
      },
    ],
    aroundExecute: [
      async (context, next, input) => {
        context.audit({ type: "tools/around-before", data: { id: context.call.id } })
        const output = await next(input)
        context.audit({ type: "tools/around-after", data: { id: context.call.id } })
        return output
      },
    ],
  })
  const normal = await runBatched(runtime, [
    { id: "read-1", name: "read_file", arguments: { path: "README.md" }, order: 1 },
    { id: "read-2", name: "read_file", arguments: { path: "README.md" }, order: 2 },
    { id: "write-1", name: "write_file", arguments: { path: "OUT.md", content: "done" }, order: 3 },
    { id: "read-3", name: "read_file", arguments: { path: "OUT.md" }, order: 4 },
  ])
  assert(normal.maxActive >= 2, "safe tools should overlap in a batch")
  assert(normal.committedIds.join(",") === "read-1,read-2,write-1,read-3", "commit order must follow model order")
  const firstOutput = normal.results[0]?.output
  assert(isRecord(firstOutput) && !Object.prototype.hasOwnProperty.call(firstOutput, "secret"), "post hook did not redact")
  assert(Object.isFrozen(firstOutput), "final tool result should be frozen")

  const denied = await runtime.run({ id: "shell-1", name: "shell", arguments: { command: "rm -rf /" }, order: 5 })
  assert(denied.status === "denied" && denied.error?.code === "POLICY_DENIED", "deny policy must be explicit")
  const approvalDenied = await runtime.run({ id: "write-denied", name: "write_file", arguments: { path: "NO.md", content: "no" }, order: 5.5 })
  assert(approvalDenied.status === "denied" && approvalDenied.error?.code === "APPROVAL_DENIED", "ask rejection must be explicit")
  const schemaFailure = await runtime.run({ id: "bad-schema", name: "read_file", arguments: { path: 7 }, order: 6 })
  assert(schemaFailure.status === "error" && schemaFailure.error?.code === "SCHEMA", "schema error must be durable")
  const timeout = await runtime.run({ id: "slow-timeout", name: "slow", arguments: { value: "x" }, order: 7, timeoutMs: 1 })
  assert(timeout.status === "timeout" && timeout.error?.code === "TIMEOUT", "timeout should be normalized")

  const cancelController = new AbortController()
  const cancelRuntime = new ToolRuntime(createTools(workspace), {
    policy: () => "allow",
    onStart: (call) => {
      if (call.id === "slow-1") cancelController.abort()
    },
  })
  const cancelled = await runRollingPool(
    cancelRuntime,
    [
      { id: "slow-1", name: "slow", arguments: { value: "a" }, order: 1 },
      { id: "slow-2", name: "slow", arguments: { value: "b" }, order: 2 },
      { id: "slow-3", name: "slow", arguments: { value: "c" }, order: 3 },
    ],
    1,
    cancelController.signal,
  )
  const syntheticCount = cancelled.results.filter((result) => !result.started).length
  assert(syntheticCount === 2, "not-started calls need synthetic cancellation results")
  assert(new Set(cancelled.results.map((result) => result.id)).size === 3, "every call needs one result")

  const facts: LessonFacts = {
    normal: {
      committedIds: normal.committedIds,
      dispatchOrder: normal.dispatchOrder,
      maxActive: normal.maxActive,
      statuses: normal.results.map((result) => result.status),
      redactedOutput: isRecord(firstOutput) && !Object.prototype.hasOwnProperty.call(firstOutput, "secret"),
      frozenResult: Object.isFrozen(firstOutput),
    },
    denied: { status: denied.status, code: denied.error?.code ?? "" },
    approvalDenied: { status: approvalDenied.status, code: approvalDenied.error?.code ?? "" },
    schemaFailure: { status: schemaFailure.status, code: schemaFailure.error?.code ?? "" },
    timeout: { status: timeout.status, code: timeout.error?.code ?? "" },
    cancelled: {
      dispatchOrder: cancelled.dispatchOrder,
      statuses: cancelled.results.map((result) => result.status),
      syntheticCount,
      uniqueResultCount: new Set(cancelled.results.map((result) => result.id)).size,
    },
  }
  const events: TraceEvent[] = [
    ...runtime.events,
    { type: "scheduler/dispatch", data: { started: [...started] } },
    { type: "scheduler/cancel", data: { dispatchOrder: [...cancelled.dispatchOrder], syntheticCount } },
  ]
  printResult("06_tool_execution_pipeline", { ...facts }, events)
  return facts
}

if (process.argv[1]?.endsWith("code.ts")) void runLesson()
