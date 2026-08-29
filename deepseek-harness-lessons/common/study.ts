/**
 * Shared study tooling for the DeepSeek Harness source-reading courses.
 *
 * The courses teach by reading the real upstream source at a locked commit.
 * Every lesson keeps an `anchors.json` describing the files, symbols and
 * source comments it cites.  This module turns those anchors into checks:
 *
 * - without a local upstream checkout it validates that the lesson material
 *   is internally consistent (anchors parse, reading order is covered, the
 *   course source-manifest agrees with the anchors) and prints the reading
 *   map for the lesson;
 * - with a checkout (DSH_SOURCE_DIR, or the course cache prepared by
 *   scripts/prepare_upstream.sh) it re-verifies every anchor against the
 *   real source, so upstream drift becomes a loud failure instead of a
 *   silently stale lesson.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { basename, dirname, join, relative } from "node:path"

export interface Anchor {
  /** Repository-relative path (file or directory) in the upstream snapshot. */
  readonly path: string
  /** Distinctive identifier expected verbatim in the file (e.g. a declaration). */
  readonly symbol?: string
  /** Verbatim phrase (comment, error message) expected in the file. */
  readonly contains?: string
  /** Why this anchor matters; shown in the reading map. */
  readonly note?: string
}

export interface AnchorFile {
  readonly lesson: string
  readonly question: string
  readonly readingOrder: readonly string[]
  readonly anchors: readonly Anchor[]
}

export type AnchorStatus = "ok" | "missing-path" | "missing-symbol" | "missing-contains"

export interface AnchorCheck {
  readonly anchor: Anchor
  readonly status: AnchorStatus
  readonly detail?: string
}

export class StudyError extends Error {}

/** Minimal assert helper reused by lesson tests (tests run with plain node). */
export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new StudyError(`assertion failed: ${message}`)
}

export function assertEqual(actual: unknown, expected: unknown, message: string): void {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  if (a !== b) throw new StudyError(`assertion failed: ${message}\n  actual:   ${a}\n  expected: ${b}`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** Load and validate a lesson's anchors.json. Throws StudyError on bad shape. */
export function readAnchorFile(lessonDir: string): AnchorFile {
  const file = join(lessonDir, "anchors.json")
  if (!existsSync(file)) throw new StudyError(`missing ${file}`)
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"))
  } catch (error) {
    throw new StudyError(`invalid JSON in ${file}: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!isRecord(parsed)) throw new StudyError(`${file}: top level must be an object`)
  const { lesson, question, readingOrder, anchors } = parsed
  if (typeof lesson !== "string" || lesson === "") throw new StudyError(`${file}: "lesson" must be a non-empty string`)
  if (typeof question !== "string" || question === "") throw new StudyError(`${file}: "question" must be a non-empty string`)
  if (!Array.isArray(readingOrder) || readingOrder.length === 0) throw new StudyError(`${file}: "readingOrder" must be a non-empty array`)
  if (readingOrder.some(item => typeof item !== "string")) throw new StudyError(`${file}: "readingOrder" entries must be strings`)
  if (!Array.isArray(anchors) || anchors.length === 0) throw new StudyError(`${file}: "anchors" must be a non-empty array`)
  for (const anchor of anchors) {
    if (!isRecord(anchor)) throw new StudyError(`${file}: every anchor must be an object`)
    if (typeof anchor.path !== "string" || anchor.path === "") throw new StudyError(`${file}: anchor.path must be a non-empty string`)
    if (anchor.symbol !== undefined && typeof anchor.symbol !== "string") throw new StudyError(`${file}: anchor.symbol must be a string`)
    if (anchor.contains !== undefined && typeof anchor.contains !== "string") throw new StudyError(`${file}: anchor.contains must be a string`)
    if (anchor.note !== undefined && typeof anchor.note !== "string") throw new StudyError(`${file}: anchor.note must be a string`)
    if (anchor.symbol === undefined && anchor.contains === undefined) {
      throw new StudyError(`${file}: anchor ${anchor.path} needs a "symbol" or "contains" target`)
    }
  }
  return { lesson, question, readingOrder, anchors }
}

/** Collect the text of a file, or of every file under a directory recursively. */
function collectSourceText(root: string): string[] {
  const stat = statSync(root)
  if (stat.isFile()) return [readFileSync(root, "utf8")]
  if (!stat.isDirectory()) return []
  const texts: string[] = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git") continue
    texts.push(...collectSourceText(join(root, entry.name)))
  }
  return texts
}

/** Verify every anchor against a real upstream checkout. */
export function checkAnchorsAgainstSource(anchors: readonly Anchor[], sourceDir: string): AnchorCheck[] {
  const results: AnchorCheck[] = []
  for (const anchor of anchors) {
    const target = join(sourceDir, anchor.path)
    if (!existsSync(target)) {
      results.push({ anchor, status: "missing-path" })
      continue
    }
    try {
      const texts = collectSourceText(target)
      if (anchor.symbol !== undefined && !texts.some(text => text.includes(anchor.symbol))) {
        results.push({ anchor, status: "missing-symbol", detail: anchor.symbol })
        continue
      }
      if (anchor.contains !== undefined && !texts.some(text => text.includes(anchor.contains))) {
        results.push({ anchor, status: "missing-contains", detail: anchor.contains })
        continue
      }
      results.push({ anchor, status: "ok" })
    } catch (error) {
      results.push({ anchor, status: "missing-path", detail: error instanceof Error ? error.message : String(error) })
    }
  }
  return results
}

/**
 * Cross-check a lesson's anchors against the course source-manifest.json.
 * Returns a list of inconsistency errors (empty when consistent):
 * anchors must cite exactly the manifest paths, and every manifest symbol
 * must be covered by an anchor target.
 */
export function crossCheckManifest(lessonId: string, anchorFile: AnchorFile, manifestPath: string): string[] {
  const errors: string[] = []
  if (!existsSync(manifestPath)) return [`missing manifest ${manifestPath}`]
  let manifest: { entries?: unknown }
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
  } catch (error) {
    return [`invalid manifest JSON: ${error instanceof Error ? error.message : String(error)}`]
  }
  const entries = Array.isArray(manifest.entries) ? manifest.entries : []
  const entry = entries.find(item => isRecord(item) && item.lesson === lessonId)
  if (!isRecord(entry)) return [`manifest has no entry for lesson ${lessonId}`]
  const manifestPaths = Array.isArray(entry.paths) ? entry.paths.filter(p => typeof p === "string") : []
  const manifestSymbols = Array.isArray(entry.symbols) ? entry.symbols.filter(s => typeof s === "string") : []

  const anchorPaths = new Set(anchorFile.anchors.map(anchor => anchor.path))
  const readingOrder = new Set(anchorFile.readingOrder)
  for (const path of manifestPaths) {
    if (!anchorPaths.has(path) && !readingOrder.has(path)) {
      errors.push(`manifest lists ${path} for lesson ${lessonId} but the lesson neither anchors nor reads it`)
    }
  }
  for (const path of anchorPaths) {
    if (!manifestPaths.includes(path)) errors.push(`anchor ${path} is missing from the manifest entry for lesson ${lessonId}`)
  }
  const anchorTargets = new Set<string>()
  for (const anchor of anchorFile.anchors) {
    if (anchor.symbol !== undefined) anchorTargets.add(anchor.symbol)
    if (anchor.contains !== undefined) anchorTargets.add(anchor.contains)
  }
  for (const symbol of manifestSymbols) {
    if (!anchorTargets.has(symbol)) errors.push(`manifest symbol ${JSON.stringify(symbol)} is not covered by any anchor in lesson ${lessonId}`)
  }
  for (const path of anchorFile.readingOrder) {
    if (!anchorPaths.has(path) && !manifestPaths.includes(path)) {
      errors.push(`readingOrder entry ${path} is neither anchored nor listed in the manifest`)
    }
  }
  return errors
}

/** Find the course root (the one holding source-manifest.json) above a lesson. */
export function findCourseRoot(startDir: string): string {
  let current = startDir
  for (let depth = 0; depth < 4; depth += 1) {
    if (existsSync(join(current, "source-manifest.json"))) return current
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  throw new StudyError(`no source-manifest.json found above ${startDir}`)
}

/** Where a prepared upstream checkout lives, if any. */
export function discoverSourceDir(defaultCacheDir: string): string | undefined {
  const fromEnv = process.env.DSH_SOURCE_DIR
  if (fromEnv !== undefined && fromEnv !== "") {
    return existsSync(join(fromEnv, "package.json")) ? fromEnv : undefined
  }
  return existsSync(join(defaultCacheDir, "package.json")) ? defaultCacheDir : undefined
}

function printReadingMap(anchorFile: AnchorFile): void {
  console.log(`本课问题：${anchorFile.question}`)
  console.log("")
  console.log("阅读地图（按顺序打开真实源码）：")
  anchorFile.readingOrder.forEach((path, index) => {
    console.log(`  ${index + 1}. ${path}`)
  })
  console.log("")
  console.log("锚点（本课引用的真实符号与注释）：")
  for (const anchor of anchorFile.anchors) {
    const target = anchor.symbol !== undefined ? `symbol: ${anchor.symbol}` : `contains: ${anchor.contains}`
    console.log(`  - ${anchor.path} (${target})`)
    if (anchor.note !== undefined) console.log(`      ${anchor.note}`)
  }
}

/**
 * Entry point used by every lesson's code.ts.  Runs the offline consistency
 * checks, verifies anchors when a source checkout is available, prints the
 * reading map, and exits non-zero on any hard failure.
 */
export function runLessonCheck(scriptPath: string, title: string, defaultSourceCache: string): void {
  const lessonDir = dirname(scriptPath)
  console.log(`== ${title} ==`)
  console.log(`lesson dir: ${lessonDir}`)
  try {
    const anchorFile = readAnchorFile(lessonDir)
    if (!basename(lessonDir).startsWith(`${anchorFile.lesson}_`)) {
      throw new StudyError(`anchors.json declares lesson ${anchorFile.lesson} but lives in a directory for another lesson`)
    }
    const courseRoot = findCourseRoot(lessonDir)
    const manifestErrors = crossCheckManifest(anchorFile.lesson, anchorFile, join(courseRoot, "source-manifest.json"))
    if (manifestErrors.length > 0) {
      for (const error of manifestErrors) console.error(`manifest mismatch: ${error}`)
      process.exitCode = 1
      return
    }
    console.log(`manifest consistency: ok (${anchorFile.anchors.length} anchors, ${anchorFile.readingOrder.length} reading steps)`)

    const sourceDir = discoverSourceDir(defaultSourceCache)
    if (sourceDir === undefined) {
      console.log("upstream checkout: absent — skipped live anchor verification")
      console.log("（运行 scripts/prepare_upstream.sh 后重跑本课，即可对真实源码逐条校验锚点）")
    } else {
      const checks = checkAnchorsAgainstSource(anchorFile.anchors, sourceDir)
      const broken = checks.filter(check => check.status !== "ok")
      console.log(`upstream checkout: ${relative(process.cwd(), sourceDir) || sourceDir}`)
      console.log(`live anchors: ${checks.length - broken.length}/${checks.length} ok`)
      if (broken.length > 0) {
        for (const check of broken) {
          const target = check.detail !== undefined ? ` (${check.detail})` : ""
          console.error(`BROKEN ANCHOR [${check.status}]: ${check.anchor.path}${target}`)
        }
        process.exitCode = 1
        return
      }
    }

    console.log("")
    printReadingMap(anchorFile)
    console.log("")
    console.log("下一步：按阅读地图打开源码；作业见 exercise.md。")
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
