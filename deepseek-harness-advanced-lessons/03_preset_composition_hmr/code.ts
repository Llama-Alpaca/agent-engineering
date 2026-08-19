/**
 * L03 - preset discovery, standing mounts, generations, and recompose.
 *
 * One preset composition is mounted once and many agent scopes join it. A
 * changed composition stamp creates a new standing generation for later
 * sessions; already joined sessions keep the exact generation they started
 * with. Recompose resolves and stages the target before swapping the binding.
 */

import { assert, deepClone, printResult, type JsonValue } from "../../deepseek-harness-lessons/common/trace.ts"

export type PresetTrust = "system" | "user"

export interface PresetRow {
  readonly id: string
  readonly service: string
  readonly active?: boolean
  readonly publishesGlobalService?: boolean
}

export interface AgentPreset {
  readonly id: string
  readonly trust: PresetTrust
  readonly root: string
  readonly stamp: string
  readonly rows: readonly PresetRow[]
  readonly broken?: string
}

export interface StandingMount {
  readonly mountId: string
  readonly presetId: string
  readonly generation: number
  readonly stamp: string
  readonly services: readonly string[]
  readonly joinedSessions: Set<string>
}

export interface MountResult {
  readonly sessionId: string
  readonly presetId: string
  readonly mountId: string
  readonly generation: number
}

const PRESET_ID = /^[a-z0-9][a-z0-9._-]*$/

function validatePreset(preset: AgentPreset): void {
  assert(PRESET_ID.test(preset.id), `invalid preset id ${preset.id}`)
  if (preset.broken !== undefined) throw new Error(`preset ${preset.id} is broken: ${preset.broken}`)
  const inactive = preset.rows.filter((row) => row.active === false)
  assert(inactive.length === 0, `preset ${preset.id} has inactive rows: ${inactive.map((row) => row.id).join(",")}`)
  const leaked = preset.rows.filter((row) => row.publishesGlobalService === true)
  assert(leaked.length === 0, `preset ${preset.id} leaks process-global services: ${leaked.map((row) => row.service).join(",")}`)
}

/** Filesystem discovery model: every read is fresh and earlier roots win ids. */
export class PresetCatalog {
  private presets: AgentPreset[]

  constructor(presets: readonly AgentPreset[]) {
    this.presets = [...deepClone(presets)]
  }

  list(): readonly AgentPreset[] {
    const found = new Map<string, AgentPreset>()
    for (const preset of this.presets) if (!found.has(preset.id)) found.set(preset.id, deepClone(preset))
    return [...found.values()]
  }

  resolve(id: string): AgentPreset {
    const preset = this.list().find((candidate) => candidate.id === id)
    assert(preset !== undefined, `unknown preset ${id}`)
    return preset
  }

  writeFixture(preset: AgentPreset): void {
    const index = this.presets.findIndex((candidate) => candidate.root === preset.root && candidate.id === preset.id)
    if (index < 0) this.presets.push(deepClone(preset))
    else this.presets[index] = deepClone(preset)
  }

  /** Authoring accepts ids, not arbitrary composition text, and copies whole directories. */
  copy(from: string, id: string, userRoot: string): AgentPreset {
    assert(PRESET_ID.test(id), `invalid preset id ${id}`)
    assert(!this.presets.some((preset) => preset.id === id), `preset ${id} already exists`)
    const source = this.resolve(from)
    const copy: AgentPreset = { ...deepClone(source), id, root: userRoot, trust: "user", stamp: `${source.stamp}:copy:${id}` }
    this.presets.push(copy)
    return deepClone(copy)
  }

  delete(id: string): void {
    const preset = this.resolve(id)
    assert(preset.trust === "user", `preset ${id} ships with the deployment`)
    this.presets = this.presets.filter((candidate) => !(candidate.root === preset.root && candidate.id === id))
  }
}

export class AgentPresetRoster {
  private readonly catalog: PresetCatalog
  private readonly standing = new Map<string, StandingMount>()
  private readonly history: StandingMount[] = []
  private readonly bindings = new Map<string, StandingMount>()
  private readonly blankSessions = new Set<string>()
  private nextGeneration = 0
  mountAttempts = 0

  constructor(catalog: PresetCatalog) {
    this.catalog = catalog
  }

  createSession(sessionId: string, blank = true): void {
    assert(!this.bindings.has(sessionId), `session ${sessionId} already exists`)
    if (blank) this.blankSessions.add(sessionId)
  }

  markNonBlank(sessionId: string): void {
    this.blankSessions.delete(sessionId)
  }

  mount(sessionId: string, presetId: string): MountResult {
    const mount = this.ensureStanding(this.catalog.resolve(presetId))
    this.bind(sessionId, mount)
    return this.result(sessionId, mount)
  }

  /** Child joins the parent's exact generation without touching discovery. */
  composeFrom(childSessionId: string, parentSessionId: string): MountResult | undefined {
    const parent = this.bindings.get(parentSessionId)
    if (parent === undefined) return undefined
    this.bind(childSessionId, parent)
    return this.result(childSessionId, parent)
  }

  /** Resolve/stage first; only a successful target can replace the old binding. */
  recompose(sessionId: string, presetId: string): MountResult {
    assert(this.blankSessions.has(sessionId), "only a blank session may switch preset")
    const target = this.ensureStanding(this.catalog.resolve(presetId))
    const previous = this.bindings.get(sessionId)
    if (previous !== undefined) previous.joinedSessions.delete(sessionId)
    this.bindings.set(sessionId, target)
    target.joinedSessions.add(sessionId)
    return this.result(sessionId, target)
  }

  mountFor(sessionId: string): StandingMount | undefined {
    return this.bindings.get(sessionId)
  }

  serviceForAgent(sessionId: string, service: string): string | undefined {
    const mount = this.bindings.get(sessionId)
    return mount?.services.includes(service) === true ? `${mount.mountId}:${service}` : undefined
  }

  generations(presetId: string): readonly StandingMount[] {
    return this.history.filter((mount) => mount.presetId === presetId)
  }

  private ensureStanding(preset: AgentPreset): StandingMount {
    validatePreset(preset)
    const current = this.standing.get(preset.id)
    if (current?.stamp === preset.stamp) return current
    this.mountAttempts += 1
    const generation = ++this.nextGeneration
    const mount: StandingMount = {
      mountId: `${preset.id}@${generation}`,
      presetId: preset.id,
      generation,
      stamp: preset.stamp,
      services: preset.rows.map((row) => row.service),
      joinedSessions: new Set(),
    }
    this.standing.set(preset.id, mount)
    this.history.push(mount)
    return mount
  }

  private bind(sessionId: string, mount: StandingMount): void {
    assert(!this.bindings.has(sessionId), `session ${sessionId} already joined a preset`)
    this.bindings.set(sessionId, mount)
    mount.joinedSessions.add(sessionId)
  }

  private result(sessionId: string, mount: StandingMount): MountResult {
    return { sessionId, presetId: mount.presetId, mountId: mount.mountId, generation: mount.generation }
  }
}

export function buildCatalog(): PresetCatalog {
  return new PresetCatalog([
    {
      id: "standard",
      trust: "system",
      root: "/system",
      stamp: "standard:v1",
      rows: [
        { id: "tools", service: "tools" },
        { id: "prompt", service: "systemPrompt" },
        { id: "projection", service: "sessionProjections" },
      ],
    },
    { id: "broken", trust: "user", root: "/user", stamp: "broken:v1", rows: [], broken: "invalid YAML" },
  ])
}

export function runPresetLab(): Record<string, JsonValue> {
  const catalog = buildCatalog()
  const roster = new AgentPresetRoster(catalog)
  roster.createSession("parent")
  roster.createSession("peer")
  roster.createSession("child")
  const parent = roster.mount("parent", "standard")
  const peer = roster.mount("peer", "standard")
  const child = roster.composeFrom("child", "parent") as MountResult

  catalog.writeFixture({
    ...catalog.resolve("standard"),
    stamp: "standard:v2",
    rows: [...catalog.resolve("standard").rows, { id: "skill", service: "skills" }],
  })
  roster.createSession("later")
  const later = roster.mount("later", "standard")
  roster.createSession("late-child")
  const lateChild = roster.composeFrom("late-child", "parent") as MountResult

  roster.createSession("switch")
  roster.mount("switch", "standard")
  let failedPreserved = false
  try {
    roster.recompose("switch", "broken")
  } catch {
    failedPreserved = roster.mountFor("switch")?.presetId === "standard"
  }

  const copy = catalog.copy("standard", "my-preset", "/user")
  roster.createSession("copy-user")
  roster.mount("copy-user", copy.id)
  catalog.delete(copy.id)

  return {
    sharedMount: parent.mountId === peer.mountId && peer.mountId === child.mountId,
    mountAttempts: roster.mountAttempts,
    parentGeneration: parent.mountId,
    laterGeneration: later.mountId,
    existingChildGeneration: lateChild.mountId,
    oldGenerationStillJoined: roster.generations("standard")[0]?.joinedSessions.size ?? 0,
    failedPreserved,
    deletedLiveService: roster.serviceForAgent("copy-user", "skills") ?? null,
  }
}

export function runLesson(): void {
  const facts = runPresetLab()
  assert(facts.sharedMount === true, "sessions mounted duplicate preset instances")
  assert(facts.parentGeneration !== facts.laterGeneration, "changed source did not create a generation")
  assert(facts.parentGeneration === facts.existingChildGeneration, "child re-read a changed preset")
  assert(facts.failedPreserved === true, "failed recompose lost the old binding")
  printResult("advanced-03-preset-standing-mount", facts)
}

const entry = process.argv[1] ?? ""
if (entry.endsWith("/03_preset_composition_hmr/code.ts") || entry.endsWith("\\03_preset_composition_hmr\\code.ts")) runLesson()
