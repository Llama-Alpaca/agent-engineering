import { assert, printResult, type TraceEvent } from "../common/trace.ts"

/**
 * This lesson defines a conceptual tool-result/view boundary. The upstream
 * request-context, compaction, skill, spill, and token-meter packages have
 * different concrete contracts; the small model here exposes only the
 * ownership and budget invariants discussed in the lesson.
 */

export type ContextStrategy = "raw" | "prune" | "spill" | "compact" | "combined"

export interface CanonicalToolResult {
  readonly id: string
  readonly value: string
  readonly importantFacts: readonly string[]
}

export interface PromptMessage {
  readonly role: "system" | "user" | "assistant" | "tool"
  readonly source: string
  readonly content: string
}

export interface PromptAssembly {
  readonly messages: readonly PromptMessage[]
  readonly systemText: string
  readonly tools: readonly string[]
  readonly text: string
  readonly tokens: number
  readonly measurementSections: readonly string[]
}

export interface StrategyMeasurement {
  readonly strategy: ContextStrategy
  readonly syntheticCanonicalBytes: number
  readonly modelVisibleChars: number
  readonly modelVisibleTokens: number
  readonly preservedFacts: readonly string[]
  readonly locators: readonly string[]
  readonly compactionCount: number
  readonly promptSkills: readonly string[]
  readonly promptContainsScopedSkill: boolean
}

export class SpillStore {
  private readonly values = new Map<string, string>()
  private nextId = 1

  put(value: string): string {
    const locator = `spill://tool-result/${this.nextId++}`
    this.values.set(locator, value)
    return locator
  }

  get(locator: string): string | undefined {
    return this.values.get(locator)
  }

  clear(): void {
    this.values.clear()
  }

  get size(): number {
    return this.values.size
  }
}

/** A scope owns local skills.  It never mutates the global skill catalogue. */
export class AgentContextScope {
  private readonly localSkills = new Map<string, string>()
  private disposed = false
  private readonly globalSkills: ReadonlyMap<string, string>
  private readonly events: TraceEvent[]

  constructor(globalSkills: ReadonlyMap<string, string>, events: TraceEvent[]) {
    this.globalSkills = globalSkills
    this.events = events
  }

  loadSkill(name: string): string {
    assert(!this.disposed, "context scope is disposed")
    const body = this.globalSkills.get(name)
    assert(body !== undefined, `unknown skill: ${name}`)
    this.localSkills.set(name, body)
    this.events.push({ type: "scope/skill-loaded", data: { name, owner: "agent-scope" } })
    return body
  }

  activeSkills(): string[] {
    return [...this.localSkills.keys()].sort()
  }

  dispose(): void {
    if (this.disposed) return
    this.localSkills.clear()
    this.disposed = true
    this.events.push({ type: "scope/disposed", data: { remainingSkills: 0 } })
  }

  get isDisposed(): boolean {
    return this.disposed
  }
}

export function estimateTokens(text: string): number {
  // A deterministic meter is enough for a view-comparison lab. It is not a
  // claim about any particular model tokenizer.
  return Math.ceil(text.length / 4)
}

export function extractFacts(text: string): string[] {
  return [...text.matchAll(/FACT:[^\n]+/g)].map((match) => match[0])
}

export function pruneToolResult(result: CanonicalToolResult, maxChars: number, events: TraceEvent[] = []): string {
  assert(maxChars > 0, "maxChars must be positive")
  if (result.value.length <= maxChars) return result.value

  const lines = result.value.split("\n")
  const facts = lines.filter((line) => line.includes("FACT:"))
  assert(facts.every((fact) => fact.length <= maxChars), "important fact cannot fit in prune budget")
  const selected: string[] = []
  for (const line of [...facts, ...lines]) {
    if (selected.includes(line)) continue
    const candidate = [...selected, line].join("\n")
    if (candidate.length <= maxChars) selected.push(line)
  }
  const view = selected.join("\n")
  assert(facts.every((fact) => selected.includes(fact)), "pruner would lose an important fact")
  events.push({
    type: "context/pruned",
    data: { resultId: result.id, beforeChars: result.value.length, afterChars: view.length },
  })
  return view
}

export function spillToolResult(
  result: CanonicalToolResult,
  store: SpillStore,
  previewChars: number,
  events: TraceEvent[] = [],
): { view: string; locator: string } {
  assert(previewChars > 0, "previewChars must be positive")
  const locator = store.put(result.value)
  const preview = result.value
    .split("\n")
    .filter((line) => !line.includes("FACT:"))
    .join(" ")
    .slice(0, previewChars)
  // Facts are a deliberate, small semantic projection. The rest remains in
  // the canonical store and can be fetched by the locator.
  const factBlock = result.importantFacts.join("\n")
  const view = `[spilled ${locator}] ${preview}\n${factBlock}\n... (retrieve canonical value with locator)`
  events.push({
    type: "context/spilled",
    data: { resultId: result.id, locator, canonicalChars: result.value.length, previewChars },
  })
  return { view, locator }
}

export function compactHistory(
  messages: readonly PromptMessage[],
  budgetTokens: number,
  events: TraceEvent[] = [],
): { messages: PromptMessage[]; count: number; preservedFacts: string[] } {
  assert(budgetTokens > 0, "budgetTokens must be positive")
  const text = messages.map((message) => message.content).join("\n")
  if (estimateTokens(text) <= budgetTokens) {
    return { messages: [...messages], count: 0, preservedFacts: extractFacts(text) }
  }

  const facts = extractFacts(text)
  const summary = [
    "[compacted history]",
    ...facts,
    `SUMMARY: ${messages.length} messages retained as a deterministic checkpoint.`,
  ].join("\n")
  assert(estimateTokens(summary) <= budgetTokens, "compaction summary cannot fit budget without losing facts")
  const compacted: PromptMessage = { role: "assistant", source: "compaction", content: summary }
  events.push({
    type: "context/compacted",
    data: { beforeMessages: messages.length, afterMessages: 1, preservedFacts: facts.length },
  })
  return { messages: [compacted], count: 1, preservedFacts: facts }
}

export function assemblePrompt(parts: {
  persona: string
  runtimeContext: string
  toolSchemas: readonly string[]
  skills: readonly string[]
  history: readonly PromptMessage[]
  events?: TraceEvent[]
}): PromptAssembly {
  const systemText = `[persona]\n${parts.persona}`
  const messages: PromptMessage[] = [
    { role: "system", source: "system-prompt", content: systemText },
    ...parts.history,
    { role: "user", source: "runtime-context-snapshot", content: parts.runtimeContext },
  ]
  if (parts.skills.length > 0) {
    messages.push({
      role: "user",
      source: "skill-catalog",
      content: `Available scoped skills: ${parts.skills.join(", ")}`,
    })
  }
  const tools = [...parts.toolSchemas]
  const text = [
    ...messages.map((message) => `${message.role}:${message.source}\n${message.content}`),
    `request.tools\n${tools.join("\n")}`,
  ].join("\n")
  const measurementSections = [...messages.map((message) => message.source), "request.tools"]
  parts.events?.push({
    type: "prompt/assembled",
    data: { measurementSections, tokens: estimateTokens(text), systemMessages: 1, tools: tools.length },
  })
  return { messages, systemText, tools, text, tokens: estimateTokens(text), measurementSections }
}

function makeCanonicalResult(): CanonicalToolResult {
  const lines = [
    "directory listing: 42 entries",
    "README.md — course overview",
    "src/agent.ts — loop implementation",
    "FACT: provider replacement leaves the consumer unchanged",
    "generated diagnostic: xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    "generated diagnostic: yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy",
    "generated diagnostic: zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz",
    "FACT: canonical tool values remain available after spill",
    "generated diagnostic: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "generated diagnostic: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "generated diagnostic: cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    "FACT: agent-local skills are removed when the scope is disposed",
  ]
  return {
    id: "search-001",
    value: lines.join("\n"),
    importantFacts: lines.filter((line) => line.includes("FACT:")),
  }
}

function runStrategy(
  strategy: ContextStrategy,
  canonical: CanonicalToolResult,
  store: SpillStore,
  events: TraceEvent[],
  skills: readonly string[],
): StrategyMeasurement {
  let toolView = canonical.value
  const locators: string[] = []
  if (strategy === "prune" || strategy === "combined") {
    toolView = pruneToolResult(canonical, 210, events)
  }
  if (strategy === "spill" || strategy === "combined") {
    const spilled = spillToolResult(canonical, store, 84, events)
    toolView = strategy === "combined"
      ? `[spilled ${spilled.locator}]\n${toolView}\n... (retrieve canonical value with locator)`
      : spilled.view
    locators.push(spilled.locator)
  }

  const history: PromptMessage[] = [
    { role: "user", source: "user-request", content: "Audit the repository and report the important facts." },
    { role: "assistant", source: "assistant-plan", content: "I will inspect files, then summarize the evidence." },
    { role: "tool", source: "repo-search", content: toolView },
  ]
  let visibleHistory = history
  let compactionCount = 0
  if (strategy === "compact" || strategy === "combined") {
    const compacted = compactHistory(history, 160, events)
    visibleHistory = compacted.messages
    compactionCount = compacted.count
  }

  const assembly = assemblePrompt({
    persona: "You are a careful repository auditor.",
    runtimeContext: "workspace=/tmp/course-lab; policy=read-only",
    toolSchemas: ["repo_search(path:string) -> evidence[]"],
    skills: skills.map((skill) => `skill:${skill} (scope-local)`),
    history: visibleHistory,
    events,
  })
  return {
    strategy,
    syntheticCanonicalBytes: new TextEncoder().encode(JSON.stringify({ type: "tool.result", result: canonical })).byteLength,
    modelVisibleChars: assembly.text.length,
    modelVisibleTokens: assembly.tokens,
    preservedFacts: extractFacts(assembly.text),
    locators,
    compactionCount,
    promptSkills: [...skills],
    promptContainsScopedSkill: skills.every((skill) => assembly.text.includes(skill)),
  }
}

export interface ContextLabResult {
  readonly canonical: CanonicalToolResult
  readonly measurements: readonly StrategyMeasurement[]
  readonly scopeSkillsBeforeDispose: readonly string[]
  readonly secondScopeSkills: readonly string[]
  readonly promptSkillIsolation: boolean
  readonly firstPromptHasScopedSkill: boolean
  readonly globalSkillNames: readonly string[]
  readonly scopeDisposed: boolean
  readonly spillCanonicalIntact: boolean
  readonly events: readonly TraceEvent[]
}

export function runContextLab(): ContextLabResult {
  const events: TraceEvent[] = []
  const canonical = makeCanonicalResult()
  const store = new SpillStore()
  const globalSkills = new Map([
    ["repo-review", "Check claims against source locators."],
    ["release-notes", "Summarize user-visible changes."],
    ["admin", "Never load this skill into an ordinary agent."],
  ])
  const scope = new AgentContextScope(globalSkills, events)
  scope.loadSkill("repo-review")
  const scopeSkillsBeforeDispose = scope.activeSkills()
  const secondScope = new AgentContextScope(globalSkills, events)
  const secondScopeSkills = secondScope.activeSkills()
  const measurements = (["raw", "prune", "spill", "compact", "combined"] as ContextStrategy[]).map((strategy) =>
    runStrategy(strategy, canonical, store, events, scope.activeSkills()),
  )
  const secondPrompt = assemblePrompt({
    persona: "You are a separate agent.",
    runtimeContext: "workspace=/tmp/course-lab",
    toolSchemas: [],
    skills: secondScopeSkills,
    history: [],
    events,
  })
  const firstPromptHasScopedSkill = measurements.every((measurement) => measurement.promptContainsScopedSkill)
  const promptSkillIsolation = firstPromptHasScopedSkill && !secondPrompt.text.includes("repo-review")
  const spillLocators = measurements.flatMap((measurement) => measurement.locators)
  const spillCanonicalIntact = spillLocators.length > 0 && spillLocators.every((locator) => store.get(locator) === canonical.value)
  scope.dispose()
  secondScope.dispose()
  return {
    canonical,
    measurements,
    scopeSkillsBeforeDispose,
    secondScopeSkills,
    promptSkillIsolation,
    firstPromptHasScopedSkill,
    globalSkillNames: [...globalSkills.keys()].sort(),
    scopeDisposed: scope.isDisposed,
    spillCanonicalIntact,
    events,
  }
}

export function main(): void {
  const result = runContextLab()
  printResult(
    "08_context_scope",
    {
      canonicalChars: result.canonical.value.length,
      syntheticCanonicalBytes: result.measurements[0].syntheticCanonicalBytes,
      measurements: result.measurements,
      scopeSkillsBeforeDispose: result.scopeSkillsBeforeDispose,
      secondScopeSkills: result.secondScopeSkills,
      promptSkillIsolation: result.promptSkillIsolation,
      firstPromptHasScopedSkill: result.firstPromptHasScopedSkill,
      globalSkillNames: result.globalSkillNames,
      scopeDisposed: result.scopeDisposed,
      spillCanonicalIntact: result.spillCanonicalIntact,
    },
    result.events,
  )
}

if (process.argv[1]?.endsWith("/08_context_scope/code.ts")) main()
