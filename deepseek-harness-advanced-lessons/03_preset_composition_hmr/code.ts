/**
 * A03 组合的事务性：Preset、Standing Mount 与 Recompose — 源码锚点校验与阅读地图。
 *
 * 本课程通过阅读真实上游源码学习；本文件不复刻上游行为。
 * 它校验本课材料自洽（anchors.json ↔ source-manifest.json），
 * 并在存在已检出的上游快照时对真实源码逐条复核锚点。
 */
import { runLessonCheck } from "../../deepseek-harness-lessons/common/study.ts"

runLessonCheck(
  process.argv[1] as string,
  "A03 组合的事务性：Preset、Standing Mount 与 Recompose",
  `${process.env.TMPDIR ?? "/tmp"}/deepseek-harness-advanced-course/source`,
)
