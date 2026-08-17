/**
 * Lesson 02 - profile/bundle composition without a YAML or Loader dependency.
 *
 * The real implementation is packages/boot/app-boot/src/profile.ts plus the
 * base/headless/web-app cordis.patch.yml files.  This lab models the part that
 * matters for reasoning: ordered layers, whole-row replacement, provenance,
 * schema validation, dependency-pending diagnostics, and transactional reload.
 */

import {
  assert,
  expectThrows,
  printResult,
  type TraceEvent,
} from "../common/trace.ts"

export type PluginConfig = Record<string, unknown>

export interface PatchRow {
  id: string
  name: string
  config?: PluginConfig
  requires?: string[]
  provides?: string[]
  enabled?: boolean
}

export interface PatchLayer {
  name: string
  rows: PatchRow[]
}

export interface ResolvedRow extends PatchRow {
  source: string
  patchedBy: string[]
}

export interface Composition {
  rows: ResolvedRow[]
  history: Record<string, string[]>
}

export interface ActivationRecord {
  id: string
  status: "active" | "pending" | "disabled"
  missing: string[]
  order?: number
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

/** Apply layers by id. A matching patch replaces the entire row config. */
export function composeLayers(layers: readonly PatchLayer[]): Composition {
  const rows: ResolvedRow[] = []
  const byId = new Map<string, ResolvedRow>()
  const history: Record<string, string[]> = {}
  for (const layer of layers) {
    for (const input of layer.rows) {
      const row: ResolvedRow = {
        ...clone(input),
        ...(input.config === undefined ? {} : { config: clone(input.config) }),
        source: layer.name,
        patchedBy: [],
      }
      const previous = byId.get(input.id)
      if (previous === undefined) {
        rows.push(row)
        byId.set(input.id, row)
        history[input.id] = [layer.name]
      } else {
        const index = rows.indexOf(previous)
        row.source = previous.source
        row.patchedBy = [...previous.patchedBy, layer.name]
        rows[index] = row
        byId.set(input.id, row)
        history[input.id] = [...(history[input.id] ?? []), layer.name]
      }
    }
  }
  return { rows, history }
}

export function dumpConfig(composition: Composition): Array<Record<string, unknown>> {
  return composition.rows.map(row => ({
    id: row.id,
    name: row.name,
    config: row.config ?? {},
    source: row.source,
    patchedBy: row.patchedBy,
    requires: row.requires ?? [],
    provides: row.provides ?? [],
    enabled: row.enabled !== false,
  }))
}

function numberInRange(value: unknown, min: number, max: number): boolean {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max
}

/** A deliberately small Schemastery-like validator for the rows in this lab. */
export function validateRow(row: PatchRow): void {
  const config = row.config ?? {}
  if (row.name === "dsh-agent-loop") {
    if (!numberInRange(config.maxSteps, 1, 100)) throw new Error(`invalid config: ${row.id}.maxSteps must be an integer 1..100`)
    if (config.mode !== "web" && config.mode !== "headless") throw new Error(`invalid config: ${row.id}.mode must be web or headless`)
  }
  if (row.name === "dsh-llm-deepseek") {
    if (typeof config.provider !== "string" || typeof config.model !== "string") throw new Error(`invalid config: ${row.id}.provider/model required`)
    if (typeof config.temperature !== "number" || config.temperature < 0 || config.temperature > 2) throw new Error(`invalid config: ${row.id}.temperature must be 0..2`)
  }
  if (row.name === "dsh-web") {
    if (!numberInRange(config.port, 1, 65535)) throw new Error(`invalid config: ${row.id}.port must be 1..65535`)
  }
  if (row.name === "dsh-logger" && !["debug", "info", "warn"].includes(String(config.level))) {
    throw new Error(`invalid config: ${row.id}.level is unknown`)
  }
}

export function validateComposition(composition: Composition): void {
  for (const row of composition.rows) validateRow(row)
}

/** Resolve service dependencies to a fixed point; row order is not startup order. */
export function resolveActivation(rows: readonly PatchRow[], initialServices: readonly string[]): ActivationRecord[] {
  const available = new Set(initialServices)
  const records: ActivationRecord[] = rows.map(row => ({
    id: row.id,
    status: row.enabled === false ? "disabled" : "pending",
    missing: [],
  }))
  const unresolved = new Set(rows.map((_, index) => index))
  let order = 0
  let changed = true
  while (changed) {
    changed = false
    for (const index of [...unresolved]) {
      const row = rows[index]
      const record = records[index]
      if (row === undefined || record === undefined || row.enabled === false) {
        unresolved.delete(index)
        continue
      }
      const missing = (row.requires ?? []).filter(service => !available.has(service))
      record.missing = missing
      if (missing.length > 0) continue
      record.status = "active"
      record.order = order++
      for (const service of row.provides ?? []) available.add(service)
      unresolved.delete(index)
      changed = true
    }
  }
  return records
}

export class Loader {
  readonly events: TraceEvent[] = []
  private current: Composition | undefined
  private active: ActivationRecord[] = []
  private generation = 0

  load(layers: readonly PatchLayer[], initialServices: readonly string[]): {
    composition: Composition
    activation: ActivationRecord[]
  } {
    const next = composeLayers(layers)
    validateComposition(next)
    const activation = resolveActivation(next.rows, initialServices)
    this.disposeCurrent()
    this.generation++
    this.current = next
    this.active = activation
    for (const record of activation.filter(item => item.status === "active").sort((a, b) => (a.order ?? 0) - (b.order ?? 0))) {
      this.events.push({ type: "loader/start", data: { generation: this.generation, id: record.id, order: record.order ?? -1 } })
    }
    for (const record of activation.filter(item => item.status === "pending")) {
      this.events.push({ type: "loader/pending", data: { generation: this.generation, id: record.id, missing: record.missing.join(",") } })
    }
    return { composition: next, activation }
  }

  private disposeCurrent(): void {
    if (this.current === undefined) return
    for (const record of [...this.active].filter(item => item.status === "active").sort((a, b) => (b.order ?? 0) - (a.order ?? 0))) {
      this.events.push({ type: "loader/dispose", data: { generation: this.generation, id: record.id } })
    }
    this.current = undefined
    this.active = []
  }

  dispose(): void {
    this.disposeCurrent()
  }
}

/** The common anti-pattern: deep merging a row's config hides replacement semantics. */
export function naiveDeepMerge(base: PluginConfig, patch: PluginConfig): PluginConfig {
  const result: PluginConfig = clone(base)
  for (const [key, value] of Object.entries(patch)) {
    if (value !== null && typeof value === "object" && !Array.isArray(value)
      && result[key] !== null && typeof result[key] === "object" && !Array.isArray(result[key])) {
      result[key] = naiveDeepMerge(result[key] as PluginConfig, value as PluginConfig)
    } else {
      result[key] = clone(value)
    }
  }
  return result
}

export function demoLayers(): { base: PatchLayer; web: PatchLayer; headless: PatchLayer; profile: PatchLayer; overlay: PatchLayer } {
  return {
    base: {
      name: "bundle:base",
      rows: [
        // Agent appears first to demonstrate that row order is not activation order.
        { id: "agent", name: "dsh-agent-loop", config: { maxSteps: 8, mode: "headless", retry: { max: 2 } }, requires: ["llm", "session"], provides: ["agent"] },
        { id: "llm", name: "dsh-llm-deepseek", config: { provider: "deepseek-official", model: "deepseek-chat", temperature: 0.2 }, requires: ["credentials"], provides: ["llm"] },
        { id: "session", name: "dsh-session", config: { root: "sessions" }, provides: ["session"] },
        { id: "logger", name: "dsh-logger", config: { level: "info" }, provides: ["logger"] },
      ],
    },
    web: {
      name: "bundle:web-app",
      rows: [{ id: "surface", name: "dsh-web", config: { port: 8787, transport: "http" }, requires: ["http"], provides: ["surface"] }],
    },
    headless: {
      name: "bundle:headless",
      rows: [{ id: "surface", name: "dsh-headless", config: { transport: "stdio" }, provides: ["surface"] }],
    },
    profile: {
      name: "profile:course",
      rows: [{ id: "agent", name: "dsh-agent-loop", config: { maxSteps: 12, mode: "headless", retry: { max: 3 } }, requires: ["llm", "session"], provides: ["agent"] }],
    },
    overlay: {
      name: "launcher:--patch",
      rows: [{ id: "logger", name: "dsh-logger", config: { level: "debug" }, provides: ["logger"] }],
    },
  }
}

export function runFailureChecks(layers: ReturnType<typeof demoLayers>): string {
  const invalid: PatchLayer = {
    name: "invalid",
    rows: [{ id: "agent", name: "dsh-agent-loop", config: { maxSteps: 0, mode: "headless" } }],
  }
  expectThrows(() => validateComposition(composeLayers([layers.base, invalid])), "maxSteps")
  const pending = resolveActivation(composeLayers([layers.base]).rows, ["http"])
  assert(pending.find(record => record.id === "llm")?.status === "pending", "missing credentials was hidden")
  assert(pending.find(record => record.id === "agent")?.status === "pending", "dependent agent was falsely active")
  return "invalid-config-loud;missing-service-pending"
}

export function runLesson(): void {
  const layers = demoLayers()
  const web = composeLayers([layers.base, layers.web])
  const headless = composeLayers([layers.base, layers.headless, layers.profile])
  validateComposition(web)
  validateComposition(headless)
  const loader = new Loader()
  const first = loader.load([layers.base, layers.headless, layers.profile], ["credentials", "http"])
  const second = loader.load([layers.base, layers.headless, layers.profile, layers.overlay], ["credentials", "http"])
  const failureCase = runFailureChecks(layers)
  const baseAgent = layers.base.rows[0]?.config ?? {}
  const patchAgent = layers.profile.rows[0]?.config ?? {}
  const mergedAgent = naiveDeepMerge(baseAgent, { maxSteps: 12 })
  loader.dispose()
  printResult("02_profile_bundle_composition", {
    webConfig: dumpConfig(web),
    headlessConfig: dumpConfig(headless),
    activationOrder: first.activation.filter(row => row.status === "active").sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map(row => row.id),
    pendingWithoutCredentials: resolveActivation(composeLayers([layers.base]).rows, ["http"]).filter(row => row.status === "pending").map(row => ({ id: row.id, missing: row.missing })),
    wholeRowReplacement: { baseAgent, patchAgent, naiveDeepMergeKeepsRetry: mergedAgent.retry !== undefined },
    reloadGeneration: second.activation.filter(row => row.status === "active").length,
    failureCase,
  }, loader.events)
}

const entry = process.argv[1] ?? ""
if (entry.endsWith("/02_profile_bundle_composition/code.ts") || entry.endsWith("\\02_profile_bundle_composition\\code.ts")) {
  runLesson()
}
