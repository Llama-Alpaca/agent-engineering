#!/usr/bin/env bash
set -euo pipefail

course_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
node_bin="$(command -v node || true)"
if [[ -z "$node_bin" ]] || ! "$node_bin" --help 2>&1 | grep -q -- '--experimental-strip-types'; then
  printf 'Node.js ^22.19.0 or >=24.0.0 with --experimental-strip-types is required.\n' >&2
  exit 2
fi

"$node_bin" -e '
  const fs = require("fs")
  const root = process.argv[1]
  const lock = JSON.parse(fs.readFileSync(`${root}/upstream.lock.json`, "utf8"))
  const manifest = JSON.parse(fs.readFileSync(`${root}/source-manifest.json`, "utf8"))
  if (lock.commit !== manifest.commit) throw new Error("upstream lock and source manifest commits differ")
  const expected = Array.from({ length: 8 }, (_, index) => String(index).padStart(2, "0"))
  const actual = manifest.entries.map((entry) => entry.lesson)
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`source manifest lessons differ: ${actual.join(",")}`)
' "$course_root"

lesson_count=0
test_count=0
for lesson_dir in "$course_root"/[0-9][0-9]_*/; do
  [[ -d "$lesson_dir" ]] || continue
  lesson_dir="${lesson_dir%/}"
  for required in README.md code.ts exercise.md; do
    [[ -f "$lesson_dir/$required" ]] || { printf 'lesson %s has no %s\n' "$(basename "$lesson_dir")" "$required" >&2; exit 1; }
  done
  printf '== %s: code ==\n' "$(basename "$lesson_dir")"
  "$node_bin" --experimental-strip-types "$lesson_dir/code.ts" >/dev/null
  lesson_count=$((lesson_count + 1))
  lesson_test_count=0
  while IFS= read -r test_file; do
    [[ -n "$test_file" ]] || continue
    printf '   test %s\n' "${test_file#"$course_root/"}"
    "$node_bin" --experimental-strip-types "$test_file"
    test_count=$((test_count + 1))
    lesson_test_count=$((lesson_test_count + 1))
  done < <(find "$lesson_dir/tests" -maxdepth 1 -type f -name '*.ts' -print 2>/dev/null | sort)
  [[ "$lesson_test_count" -gt 0 ]] || { printf 'lesson %s has no tests/*.ts file\n' "$(basename "$lesson_dir")" >&2; exit 1; }
done

[[ "$lesson_count" -eq 8 ]] || { printf 'expected 8 lessons, found %s\n' "$lesson_count" >&2; exit 1; }
printf 'advanced course tests: ok (%s lessons, %s test files)\n' "$lesson_count" "$test_count"
