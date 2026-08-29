/**
 * Course-level checks for the lab-driven course: anchors.json shape and
 * lock-file agreement, plus validator behavior against a fake source tree
 * (missing path / missing symbol / missing contains must each be caught).
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkAnchorsAgainstSource } from '../common/study.ts'

const courseRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..')

const anchors = JSON.parse(readFileSync(join(courseRoot, 'anchors.json'), 'utf8')) as {
  course: string
  commit: string
  anchors: { path: string, symbol?: string, contains?: string, doc?: string }[]
}
const lock = JSON.parse(readFileSync(join(courseRoot, 'upstream.lock.json'), 'utf8')) as { commit: string }

if (anchors.commit !== lock.commit) throw new Error(`anchors commit ${anchors.commit} != lock ${lock.commit}`)
if (anchors.anchors.length < 50) throw new Error(`expected >=50 course anchors, got ${anchors.anchors.length}`)
for (const anchor of anchors.anchors) {
  if (anchor.symbol === undefined && anchor.contains === undefined) {
    throw new Error(`anchor without target: ${anchor.path}`)
  }
}

// Validator behavior on a fake checkout: every breakage kind is reported.
const fake = mkdtempSync(join(tmpdir(), 'dsh-course12-anchors-'))
try {
  mkdirSync(join(fake, 'src'), { recursive: true })
  const content = [
    'export function keepMe() { return 1 }',
    '// the exact comment line to find',
    'export function settleAfterQuiescence() {}',
  ].join('\n')
  writeFileSync(join(fake, 'src', 'real.ts'), content)

  const checks = checkAnchorsAgainstSource([
    { path: 'src/real.ts', symbol: 'keepMe' },
    { path: 'src/real.ts', contains: 'the exact comment line to find' },
    { path: 'src/missing.ts', symbol: 'whatever' },
    { path: 'src/real.ts', symbol: 'notThere' },
    { path: 'src/real.ts', contains: 'no such sentence' },
  ], fake)

  const statuses = checks.map((check) => check.status)
  if (JSON.stringify(statuses) !== JSON.stringify(['ok', 'ok', 'missing-path', 'missing-symbol', 'missing-contains'])) {
    throw new Error(`unexpected statuses: ${statuses.join(', ')}`)
  }
} finally {
  rmSync(fake, { recursive: true, force: true })
}

console.log('course12 checks: ok')
