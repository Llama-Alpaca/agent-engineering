#!/usr/bin/env bash
set -euo pipefail

course_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
node_bin="$(command -v node || true)"

if [[ -z "$node_bin" ]]; then
  printf 'Node.js is required (see deepseek-harness-lessons/README.md)\n' >&2
  exit 2
fi

if ! "$node_bin" --help 2>&1 | grep -q -- '--experimental-strip-types'; then
  printf 'This Node.js does not expose --experimental-strip-types; use Node ^22.19.0 or >=24.0.0.\n' >&2
  exit 2
fi

lesson_count=0
test_count=0
for lesson_dir in "$course_root"/[0-9][0-9]_*/; do
  [[ -d "$lesson_dir" ]] || continue
  lesson_dir="${lesson_dir%/}"
  lesson_name="$(basename "$lesson_dir")"
  code_file="$lesson_dir/code.ts"
  if [[ ! -f "$code_file" ]]; then
    printf 'lesson %s has no code.ts\n' "$lesson_name" >&2
    exit 1
  fi

  printf '== %s: code ==\n' "$lesson_name"
  "$node_bin" --experimental-strip-types "$code_file" >/dev/null
  lesson_count=$((lesson_count + 1))

  lesson_test_count=0
  while IFS= read -r test_file; do
    [[ -n "$test_file" ]] || continue
    printf '   test %s\n' "${test_file#"$course_root/"}"
    "$node_bin" --experimental-strip-types "$test_file"
    test_count=$((test_count + 1))
    lesson_test_count=$((lesson_test_count + 1))
  done < <(find "$lesson_dir/tests" -maxdepth 1 -type f -name '*.ts' -print 2>/dev/null | sort)

  if [[ "$lesson_test_count" -eq 0 ]]; then
    printf 'lesson %s has no tests/*.ts file\n' "$lesson_name" >&2
    exit 1
  fi
done

if [[ "$lesson_count" -ne 12 ]]; then
  printf 'expected 12 lessons, found %s\n' "$lesson_count" >&2
  exit 1
fi

printf 'course tests: ok (%s lessons, %s test files)\n' "$lesson_count" "$test_count"
