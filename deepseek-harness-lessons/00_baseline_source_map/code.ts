/**
 * Lesson 00 - a small, keyless map of the locked DeepSeek Harness snapshot.
 *
 * This is deliberately an offline lab.  It does not import the upstream
 * workspace (which would require installing 200+ packages); instead it checks
 * the repository lock/manifest and replays the two event streams that later
 * lessons will use.  The source anchors in the output point at the real
 * snapshot, while the executable state machine below is course-owned.
 */

import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import {
  assert,
  expectThrows,
  printResult,
  type TraceEvent,
} from "../common/trace.ts"

export const LOCKED_COMMIT = "47f943859bef60e4160492346772ded9b24f765a"

export interface UpstreamLock {
  repository: string
  commit: string
  rootVersion: string
  publishedCliVersionAtInspection: string
  license: string
  engines: { node: string }
  packageManager: string
}

export interface SourceManifestEntry {
  lesson: string
  paths: string[]
  symbols: string[]
}

export interface SourceMap {
  commit: string
  lesson: "00"
  layers: string[]
  anchors: Array<{ path: string; symbols: string[] }>
  bridge: string[]
}

export interface BaselineEvent extends TraceEvent {
  readonly data: {
    readonly stream: "durable" | "live"
    readonly [key: string]: string | number | boolean | null
  }
}

function courseRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..")
}

export function readLockedMetadata(root = courseRoot()): {
  lock: UpstreamLock
  manifest: { commit: string; entries: SourceManifestEntry[] }
} {
  const lock = JSON.parse(readFileSync(resolve(root, "upstream.lock.json"), "utf8")) as UpstreamLock
  const manifest = JSON.parse(readFileSync(resolve(root, "source-manifest.json"), "utf8")) as {
    commit: string
    entries: SourceManifestEntry[]
  }
  return { lock, manifest }
}

/** Fail loudly instead of silently teaching against a moving `master`. */
export function verifyLock(lock: UpstreamLock, manifestCommit: string): void {
  assert(lock.commit === LOCKED_COMMIT, `upstream lock drift: ${lock.commit}`)
  assert(manifestCommit === LOCKED_COMMIT, `source manifest drift: ${manifestCommit}`)
  assert(lock.repository.endsWith("deepseek-harness.git"), "unexpected upstream repository")
  assert(lock.license === "MIT", "the course expects the MIT snapshot")
  assert(lock.engines.node.includes("22.19.0"), "Node compatibility contract changed")
  assert(lock.packageManager === "pnpm@11.7.0", "pnpm compatibility contract changed")
}

export function buildSourceMap(
  lock: UpstreamLock,
  manifest: { commit: string; entries: SourceManifestEntry[] },
): SourceMap {
  verifyLock(lock, manifest.commit)
  const entry = manifest.entries.find(item => item.lesson === "00")
  assert(entry !== undefined, "manifest has no lesson 00 entry")
  const rootAnchors = [
    { path: "README.md", symbols: ["developer preview", "product surfaces"] },
    { path: "package.json", symbols: ["version", "engines", "packageManager", "workspaces"] },
  ]
  return {
    commit: lock.commit,
    lesson: "00",
    layers: [
      "CLI (apps/cli/src/bin.ts)",
      "profile boot (apps/cli/src/profile-boot.ts)",
      "bundle/profile patch layers",
      "Cordis Loader tree",
      "Agent registry and loop",
    ],
    anchors: [
      ...rootAnchors,
      ...entry.paths.map(path => ({ path, symbols: [...entry.symbols] })),
    ],
    bridge: [
      "ESM imports with explicit .ts extensions",
      "discriminated unions for stream/event variants",
      "async generators for LLM chunks",
      "workspace package imports are resolved by the upstream Loader",
      "Vitest tests observe deterministic event traces",
    ],
  }
}

function baselineEvent(
  stream: "durable" | "live",
  type: string,
  data: Record<string, string | number | boolean | null> = {},
): BaselineEvent {
  return { type, data: { stream, ...data } }
}

/**
 * A tiny replay fixture.  Durable events are the source of truth for resume;
 * live events are process-local notifications and are intentionally not used
 * to reconstruct the model prompt.
 */
export function buildBaselineEventTrace(): BaselineEvent[] {
  return [
    baselineEvent("durable", "turn/start", { turn: 1 }),
    baselineEvent("live", "agent/status", { status: "running" }),
    baselineEvent("durable", "agent/inbox/spliced", { target: "next-turn", inserted: 1 }),
    baselineEvent("live", "agent/inbox/claimed", { turn: 1, message: "m-1" }),
    baselineEvent("live", "agent/pre-step", { turn: 1, step: 1 }),
    baselineEvent("durable", "step/start", { turn: 1, step: 1 }),
    baselineEvent("durable", "request/header", { reason: "initial", provider: "scripted", model: "offline" }),
    baselineEvent("live", "agent/request", { turn: 1, step: 1 }),
    baselineEvent("live", "llm/stream", { chunks: 2 }),
    baselineEvent("durable", "assistant/chunk", { turn: 1, step: 1, chunk: 1 }),
    baselineEvent("durable", "assistant/chunk", { turn: 1, step: 1, chunk: 2 }),
    baselineEvent("durable", "assistant/message", { turn: 1, step: 1, content: "done" }),
    baselineEvent("durable", "step/end", { turn: 1, step: 1 }),
    baselineEvent("durable", "turn/end", { turn: 1, reason: "completed" }),
    baselineEvent("live", "agent/status", { status: "idle" }),
  ]
}

export function assertBalancedTrace(events: readonly BaselineEvent[]): void {
  const turns = new Set<number>()
  const steps = new Set<string>()
  for (const event of events) {
    if (event.type === "turn/start") turns.add(Number(event.data.turn))
    if (event.type === "turn/end") {
      const turn = Number(event.data.turn)
      assert(turns.has(turn), `turn ${turn} ended before it started`)
      turns.delete(turn)
    }
    if (event.type === "step/start") steps.add(`${event.data.turn}/${event.data.step}`)
    if (event.type === "step/end") {
      const key = `${event.data.turn}/${event.data.step}`
      assert(steps.has(key), `step ${key} ended before it started`)
      steps.delete(key)
    }
  }
  assert(turns.size === 0, "replay has an open turn")
  assert(steps.size === 0, "replay has an open step")
}

type StreamChunk =
  | { kind: "text"; text: string }
  | { kind: "usage"; inputTokens: number; outputTokens: number }
  | { kind: "done" }

async function* scriptedStream(): AsyncGenerator<StreamChunk> {
  yield { kind: "text", text: "source" }
  yield { kind: "text", text: " map" }
  yield { kind: "usage", inputTokens: 12, outputTokens: 2 }
  yield { kind: "done" }
}

export async function consumeScriptedStream(): Promise<{ text: string; usage: string }> {
  let text = ""
  let usage = "none"
  for await (const chunk of scriptedStream()) {
    if (chunk.kind === "text") text += chunk.text
    if (chunk.kind === "usage") usage = `${chunk.inputTokens}+${chunk.outputTokens}`
  }
  return { text, usage }
}

export function runFailureChecks(lock: UpstreamLock, manifestCommit: string): string {
  const drifted = { ...lock, commit: `${lock.commit.slice(0, -1)}0` }
  expectThrows(() => verifyLock(drifted, manifestCommit), "upstream lock drift")
  const malformed = buildBaselineEventTrace().slice(1)
  expectThrows(() => assertBalancedTrace(malformed), "ended before it started")
  return "lock-drift-and-unbalanced-replay-rejected"
}

export async function runLesson(): Promise<void> {
  const { lock, manifest } = readLockedMetadata()
  const sourceMap = buildSourceMap(lock, manifest)
  const events = buildBaselineEventTrace()
  assertBalancedTrace(events)
  const stream = await consumeScriptedStream()
  const failureCase = runFailureChecks(lock, manifest.commit)
  printResult("00_baseline_source_map", {
    commit: lock.commit,
    sourceVersion: lock.rootVersion,
    publishedCliAtInspection: lock.publishedCliVersionAtInspection,
    sourceMap,
    durableEventCount: events.filter(event => event.data.stream === "durable").length,
    liveEventCount: events.filter(event => event.data.stream === "live").length,
    stream,
    failureCase,
  }, events)
}

const entry = process.argv[1] ?? ""
if (entry.endsWith("/00_baseline_source_map/code.ts") || entry.endsWith("\\00_baseline_source_map\\code.ts")) {
  await runLesson()
}
