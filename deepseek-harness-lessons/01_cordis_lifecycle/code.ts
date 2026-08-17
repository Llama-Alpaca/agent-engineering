/**
 * Lesson 01 - a dependency-free miniature of the Cordis lifecycle.
 *
 * The real snapshot lives under vendor/cordis/src/{context,service,events,fiber}.ts.
 * This lab keeps the same invariants in a small implementation so it can run
 * with Node's type stripping and no package installation.
 */

import {
  assert,
  printResult,
  type TraceEvent,
} from "../common/trace.ts"

export type Disposer = () => void
export type EventListener<T = unknown> = (payload: T, next?: (payload?: T) => Promise<unknown>) => unknown

type StoredEventListener = (payload: unknown, next?: (payload?: unknown) => Promise<unknown>) => unknown

export interface ResourceCounts {
  listeners: number
  timers: number
  services: number
}

export class Fiber {
  readonly name: string
  private readonly disposers: Disposer[] = []
  private disposed = false

  constructor(name: string) {
    this.name = name
  }

  get active(): boolean {
    return !this.disposed
  }

  add(disposer: Disposer): void {
    if (this.disposed) {
      disposer()
      return
    }
    this.disposers.push(disposer)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const disposer of this.disposers.splice(0).reverse()) disposer()
  }
}

interface ListenerRecord {
  readonly fiber: Fiber
  readonly listener: StoredEventListener
  readonly label: string
}

interface PendingPlugin {
  readonly name: string
  readonly dependencies: readonly string[]
  readonly setup: (ctx: Context, fiber: Fiber) => void
  fiber?: Fiber
  disposed: boolean
}

/** The methods mirror Cordis vocabulary: `provide`/`inject`, `effect`, `on`, and dispatch modes. */
export class Context {
  private readonly services = new Map<string, unknown>()
  private readonly serviceDisposers = new Map<string, Disposer>()
  private readonly fibers = new Set<Fiber>()
  private readonly listeners = new Map<string, ListenerRecord[]>()
  private readonly pending = new Set<PendingPlugin>()
  readonly resources: ResourceCounts = { listeners: 0, timers: 0, services: 0 }

  install(name: string, setup: (ctx: Context, fiber: Fiber) => void): Fiber {
    const fiber = new Fiber(name)
    this.fibers.add(fiber)
    try {
      setup(this, fiber)
    } catch (error) {
      fiber.dispose()
      this.fibers.delete(fiber)
      throw error
    }
    const originalDispose = fiber.dispose.bind(fiber)
    fiber.dispose = () => {
      originalDispose()
      this.fibers.delete(fiber)
    }
    return fiber
  }

  effect(fiber: Fiber, setup: () => void | Disposer): void {
    if (!fiber.active) throw new Error("cannot create effect on inactive context")
    const disposer = setup()
    if (typeof disposer === "function") fiber.add(disposer)
  }

  provide(name: string, value: unknown, owner?: Fiber): Disposer {
    if (this.services.has(name)) throw new Error(`service already provided: ${name}`)
    this.services.set(name, value)
    this.resources.services++
    let active = true
    const dispose = () => {
      if (!active) return
      active = false
      if (this.services.get(name) === value) this.services.delete(name)
      this.resources.services--
      this.serviceDisposers.delete(name)
      this.refreshPending()
    }
    this.serviceDisposers.set(name, dispose)
    owner?.add(dispose)
    this.refreshPending()
    return dispose
  }

  service<T>(name: string): T | undefined {
    return this.services.get(name) as T | undefined
  }

  on<T>(event: string, listener: EventListener<T>, fiber: Fiber, label = `${event}/listener`): Disposer {
    if (!fiber.active) throw new Error("cannot register listener on inactive fiber")
    const records = this.listeners.get(event) ?? []
    // The string-keyed registry is intentionally untyped. Erase T once at its
    // boundary while preserving the relationship between payload and next().
    const storedListener: StoredEventListener = (payload, next) => listener(
      payload as T,
      next === undefined ? undefined : (nextPayload) => next(nextPayload),
    )
    const record: ListenerRecord = { fiber, listener: storedListener, label }
    records.push(record)
    this.listeners.set(event, records)
    this.resources.listeners++
    let active = true
    const dispose = () => {
      if (!active) return
      active = false
      const current = this.listeners.get(event) ?? []
      const index = current.indexOf(record)
      if (index >= 0) current.splice(index, 1)
      if (current.length === 0) this.listeners.delete(event)
      this.resources.listeners--
    }
    fiber.add(dispose)
    return dispose
  }

  timer(fiber: Fiber, label = "timer"): void {
    if (!fiber.active) throw new Error("cannot create timer on inactive fiber")
    this.resources.timers++
    let active = true
    fiber.add(() => {
      if (!active) return
      active = false
      this.resources.timers--
    })
    void label
  }

  /** Wait for dependencies, then create a child fiber. Removing a service unloads it. */
  inject(
    name: string,
    dependencies: readonly string[],
    setup: (ctx: Context, fiber: Fiber) => void,
  ): { dispose(): void; get active(): boolean } {
    const pending: PendingPlugin = {
      name,
      dependencies: [...dependencies],
      setup,
      disposed: false,
    }
    const handle = {
      dispose: () => {
        if (pending.disposed) return
        pending.disposed = true
        pending.fiber?.dispose()
        this.pending.delete(pending)
      },
      get active() {
        return pending.fiber?.active === true
      },
    }
    this.pending.add(pending)
    this.refreshPending()
    return handle
  }

  private refreshPending(): void {
    for (const pending of this.pending) {
      if (pending.disposed) continue
      const ready = pending.dependencies.every(name => this.services.has(name))
      if (ready && pending.fiber === undefined) {
        pending.fiber = this.install(pending.name, pending.setup)
      } else if (!ready && pending.fiber !== undefined) {
        pending.fiber.dispose()
        pending.fiber = undefined
      }
    }
  }

  emit<T>(event: string, payload: T): void {
    for (const record of [...(this.listeners.get(event) ?? [])]) {
      // Cordis `emit` is synchronous fire-and-forget; returned promises are not awaited.
      void record.listener(payload)
    }
  }

  async parallel<T>(event: string, payload: T): Promise<void> {
    await Promise.all((this.listeners.get(event) ?? []).map(record => Promise.resolve(record.listener(payload))))
  }

  async serial<T>(event: string, payload: T): Promise<unknown> {
    for (const record of [...(this.listeners.get(event) ?? [])]) {
      const result = await Promise.resolve(record.listener(payload))
      if (result !== undefined && result !== null && result !== false) return result
    }
    return undefined
  }

  async waterfall<T>(event: string, payload: T): Promise<{ shortCircuited: boolean; value: unknown }> {
    const records = [...(this.listeners.get(event) ?? [])]
    const invoke = async (index: number, current: T): Promise<{ shortCircuited: boolean; value: unknown }> => {
      const record = records[index]
      if (record === undefined) return { shortCircuited: false, value: current }
      let called = false
      let downstream: { shortCircuited: boolean; value: unknown } | undefined
      const next = async (nextPayload?: unknown) => {
        called = true
        downstream = await invoke(index + 1, nextPayload === undefined ? current : nextPayload as T)
        return downstream.value
      }
      const value = await Promise.resolve(record.listener(current, next))
      if (!called) return { shortCircuited: true, value }
      return downstream ?? { shortCircuited: false, value }
    }
    return invoke(0, payload)
  }

  async strictWaterfall<T>(event: string, payload: T): Promise<unknown> {
    const result = await this.waterfall(event, payload)
    if (result.shortCircuited) throw new Error(`waterfall listener for ${event} did not call next()`)
    return result.value
  }
}

function record(trace: TraceEvent[], type: string, data: Record<string, string | number | boolean>): void {
  trace.push({ type, data })
}

export async function runLesson(): Promise<void> {
  const ctx = new Context()
  const trace: TraceEvent[] = []

  const observer = ctx.inject("metrics-observer", ["metrics"], (runtime, fiber) => {
    record(trace, "observer/active", { dependency: "metrics" })
    runtime.on("tick", value => record(trace, "observer/tick", { value: String(value) }), fiber)
    runtime.effect(fiber, () => () => record(trace, "observer/disposed", { reason: "dependency-removed" }))
  })
  record(trace, "observer/pending", { active: observer.active })

  const firstProvider = ctx.install("metrics-provider-1", (runtime, fiber) => {
    runtime.provide("metrics", { generation: 1 }, fiber)
    record(trace, "service/provided", { generation: 1 })
  })
  record(trace, "observer/activated", { active: observer.active })
  await ctx.emit("tick", 1)
  firstProvider.dispose()
  record(trace, "observer/deactivated", { active: observer.active })

  const secondProvider = ctx.install("metrics-provider-2", (runtime, fiber) => {
    runtime.provide("metrics", { generation: 2 }, fiber)
    record(trace, "service/provided", { generation: 2 })
  })
  await ctx.emit("tick", 2)

  const modeFiber = ctx.install("dispatch-demo", (runtime, fiber) => {
    runtime.on("mode", value => record(trace, "mode/a", { value: String(value) }), fiber, "mode/a")
    runtime.on("mode", async value => {
      await Promise.resolve()
      record(trace, "mode/b", { value: String(value) })
    }, fiber, "mode/b")
    runtime.on("decision", async (value, next) => {
      record(trace, "waterfall/outer", { value: String(value) })
      return next?.(`${String(value)}->outer`)
    }, fiber, "waterfall/outer")
    runtime.on("decision", value => {
      record(trace, "waterfall/short-circuit", { value: String(value) })
      return "blocked"
    }, fiber, "waterfall/missing-next")
  })
  await ctx.emit("mode", "emit")
  await ctx.serial("mode", "serial")
  await ctx.parallel("mode", "parallel")
  const waterfall = await ctx.waterfall("decision", "request")
  record(trace, "waterfall/result", { shortCircuited: waterfall.shortCircuited })
  let strictFailure = ""
  try {
    await ctx.strictWaterfall("decision", "request")
  } catch (error) {
    strictFailure = error instanceof Error ? error.message : String(error)
  }
  assert(strictFailure.includes("did not call next()"), "strict waterfall did not expose the short circuit")

  // A listener and a logical timer are both owned by the same fiber. Repeated
  // load/unload is the HMR safety property: counts return to their baseline.
  const baseline = { ...ctx.resources }
  for (let generation = 1; generation <= 3; generation++) {
    const hot = ctx.install(`hot-${generation}`, (runtime, fiber) => {
      runtime.on("hot", () => undefined, fiber)
      runtime.timer(fiber, `hot-timer-${generation}`)
    })
    hot.dispose()
  }
  assert(JSON.stringify(ctx.resources) === JSON.stringify(baseline), "HMR cycle leaked a resource")
  modeFiber.dispose()
  secondProvider.dispose()
  observer.dispose()
  assert(ctx.resources.listeners === 0, "listener leak after teardown")
  assert(ctx.resources.timers === 0, "timer leak after teardown")
  assert(ctx.resources.services === 0, "service leak after teardown")

  printResult("01_cordis_lifecycle", {
    dependencyInjection: "pending -> active -> pending -> active",
    waterfallShortCircuit: waterfall.shortCircuited,
    strictFailure,
    hmrBaseline: baseline,
    resourcesAfterTeardown: ctx.resources,
    eventModeOrder: trace.filter(event => event.type.startsWith("mode/")).map(event => event.type),
  }, trace)
}

const entry = process.argv[1] ?? ""
if (entry.endsWith("/01_cordis_lifecycle/code.ts") || entry.endsWith("\\01_cordis_lifecycle\\code.ts")) {
  await runLesson()
}
