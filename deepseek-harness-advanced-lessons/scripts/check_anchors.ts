/**
 * Course-level anchor checker for the lab-driven course.
 * Keyless (no checkout): validates anchors.json shape and internal
 * consistency. With a checkout (DSH_SOURCE_DIR or the course cache):
 * re-verifies every anchor against the real pinned source; any BROKEN
 * anchor is a hard failure.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkAnchorsAgainstSource } from '../../deepseek-harness-lessons/common/study.ts'

interface CourseAnchor {
  path: string
  symbol?: string
  contains?: string
  note?: string
  doc?: string
}

interface CourseAnchors {
  course: string
  commit: string
  anchors: CourseAnchor[]
}

const courseRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const anchorsPath = join(courseRoot, 'anchors.json')
const lockPath = join(courseRoot, 'upstream.lock.json')

const file = JSON.parse(readFileSync(anchorsPath, 'utf8')) as CourseAnchors
const lock = JSON.parse(readFileSync(lockPath, 'utf8')) as { commit: string }

const problems: string[] = []
if (file.commit !== lock.commit) {
  problems.push(`anchors.commit ${file.commit} != upstream.lock.json commit ${lock.commit}`)
}
if (!Array.isArray(file.anchors) || file.anchors.length === 0) {
  problems.push('anchors.json has no anchors')
}
for (const anchor of file.anchors ?? []) {
  if (typeof anchor.path !== 'string' || anchor.path.length === 0) problems.push(`anchor without path: ${JSON.stringify(anchor)}`)
  if (anchor.symbol === undefined && anchor.contains === undefined) {
    problems.push(`anchor without symbol/contains: ${anchor.path}`)
  }
  if (anchor.doc !== undefined && !existsSync(join(courseRoot, anchor.doc))) {
    problems.push(`anchor doc not found: ${anchor.doc} (${anchor.path})`)
  }
}
if (problems.length > 0) {
  for (const problem of problems) console.error(`INVALID ANCHOR ENTRY: ${problem}`)
  process.exit(1)
}

console.log(`course anchors: ${file.anchors.length} entries for ${file.course} @ ${file.commit.slice(0, 7)}`)

const sourceDir = process.env.DSH_SOURCE_DIR
  ?? (existsSync(join(courseRoot, '..', '.dsh-source-present')) ? join(courseRoot, '..') : undefined)
if (sourceDir === undefined || !existsSync(sourceDir)) {
  console.log('no upstream checkout found (set DSH_SOURCE_DIR) — keyless consistency check only')
  process.exit(0)
}

const checks = checkAnchorsAgainstSource(file.anchors, sourceDir)
const broken = checks.filter((check) => check.status !== 'ok')
for (const check of checks) {
  if (check.status !== 'ok') console.error(`BROKEN ANCHOR [${check.status}]: ${check.path} (${check.detail})`)
}
if (broken.length > 0) {
  console.error(`${broken.length}/${checks.length} anchors broken against ${sourceDir}`)
  process.exit(1)
}
console.log(`anchors: ok (verified against ${sourceDir})`)
