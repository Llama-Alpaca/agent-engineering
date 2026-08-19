#!/usr/bin/env bash
set -euo pipefail

lesson="${1:-}"
root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ -z "$lesson" ]]; then
  printf 'usage: %s <00..07>\n' "$0" >&2
  exit 2
fi

lesson_dir="$(find "$root_dir" -maxdepth 1 -type d -name "${lesson}_*" -print -quit)"
if [[ -z "$lesson_dir" || ! -f "$lesson_dir/code.ts" ]]; then
  printf 'unknown or incomplete lesson: %s\n' "$lesson" >&2
  exit 2
fi

node_bin="$(command -v node || true)"
if [[ -z "$node_bin" ]] || ! "$node_bin" --help 2>&1 | grep -q -- '--experimental-strip-types'; then
  printf 'Node.js ^22.19.0 or >=24.0.0 with --experimental-strip-types is required.\n' >&2
  exit 2
fi

exec "$node_bin" --experimental-strip-types "$lesson_dir/code.ts"
