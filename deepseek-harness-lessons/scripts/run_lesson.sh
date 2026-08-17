#!/usr/bin/env bash
set -euo pipefail

lesson="${1:-}"
root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ -z "$lesson" ]]; then
  printf 'usage: %s <00..11>\n' "$0" >&2
  exit 2
fi

lesson_dir="$(find "$root_dir" -maxdepth 1 -type d -name "${lesson}_*" -print -quit)"
if [[ -z "$lesson_dir" ]]; then
  printf 'unknown lesson: %s\n' "$lesson" >&2
  exit 2
fi

if [[ ! -f "$lesson_dir/code.ts" ]]; then
  printf 'lesson %s has no code.ts yet\n' "$lesson" >&2
  exit 2
fi

node_bin="$(command -v node || true)"
if [[ -z "$node_bin" ]]; then
  printf 'Node.js is required (see deepseek-harness-lessons/README.md)\n' >&2
  exit 2
fi

if "$node_bin" --help 2>&1 | grep -q -- '--experimental-strip-types'; then
  exec "$node_bin" --experimental-strip-types "$lesson_dir/code.ts"
fi

printf 'This Node.js does not expose --experimental-strip-types; use Node ^22.19.0 or >=24.0.0.\n' >&2
exit 2
