/**
 * 学习工具测试：锚点文件有效、与课程清单一致，且校验器能抓出被篡改的锚点。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import {
  assert,
  assertEqual,
  checkAnchorsAgainstSource,
  crossCheckManifest,
  findCourseRoot,
  readAnchorFile,
  type Anchor,
} from "../../../deepseek-harness-lessons/common/study.ts"

const lessonDir = dirname(process.argv[1] as string)
const courseRoot = findCourseRoot(dirname(lessonDir))

const anchorFile = readAnchorFile(dirname(lessonDir))
assert(anchorFile.readingOrder.length > 0, "readingOrder must not be empty")
assert(anchorFile.anchors.length > 0, "anchors must not be empty")
assertEqual(
  crossCheckManifest(anchorFile.lesson, anchorFile, join(courseRoot, "source-manifest.json")),
  [],
  "anchors agree with source-manifest.json",
)

/** Build a throwaway source tree whose files satisfy (or break) the anchors. */
function fakeSource(tamper: (anchor: Anchor) => string | null): string {
  const root = mkdtempSync(join(tmpdir(), "dsh-study-check-"))
  const byPath = new Map<string, string[]>()
  for (const anchor of anchorFile.anchors) {
    const text = tamper(anchor)
    if (text === null) continue
    byPath.set(anchor.path, [...(byPath.get(anchor.path) ?? []), text])
  }
  for (const [path, chunks] of byPath) {
    const target = join(root, path)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, chunks.join("\n"))
  }
  return root
}

const happy = fakeSource(anchor => [anchor.symbol ?? "", anchor.contains ?? "", "// padding"].join("\n"))
const symbolDropped = fakeSource(anchor => (anchor.symbol === undefined ? null : "// no symbols here"))
const containsDropped = fakeSource(anchor => (anchor.contains === undefined ? null : "export const unrelated = 1"))
const emptyRoot = mkdtempSync(join(tmpdir(), "dsh-study-empty-"))

try {
  assertEqual(
    checkAnchorsAgainstSource(anchorFile.anchors, happy).map(check => check.status),
    anchorFile.anchors.map(() => "ok"),
    "satisfied anchors pass against a real-shaped tree",
  )
  assert(
    checkAnchorsAgainstSource(anchorFile.anchors, emptyRoot).every(check => check.status === "missing-path"),
    "missing paths are reported",
  )
  assert(
    checkAnchorsAgainstSource(anchorFile.anchors, symbolDropped).some(check => check.status === "missing-symbol"),
    "a dropped symbol is reported",
  )
  assert(
    checkAnchorsAgainstSource(anchorFile.anchors, containsDropped).some(check => check.status === "missing-contains"),
    "a dropped phrase is reported",
  )
} finally {
  for (const root of [happy, symbolDropped, containsDropped, emptyRoot]) {
    rmSync(root, { recursive: true, force: true })
  }
}

console.log(`lesson ${anchorFile.lesson} study checks: ok (${anchorFile.anchors.length} anchors)`)
