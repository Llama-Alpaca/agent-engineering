#!/usr/bin/env bash
set -euo pipefail

course_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
lock_file="$course_root/upstream.lock.json"
cache_root="${DSH_COURSE_CACHE_DIR:-${TMPDIR:-/tmp}/deepseek-harness-course}"
repo_root="$cache_root/source"

commit="$(node -e 'const fs=require("fs"); const x=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(x.commit)' "$lock_file")"
repository="$(node -e 'const fs=require("fs"); const x=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(x.repository)' "$lock_file")"

mkdir -p "$cache_root"
if [[ ! -d "$repo_root/.git" ]]; then
  git clone --filter=blob:none "$repository" "$repo_root"
fi

git -C "$repo_root" fetch --quiet --depth=1 origin "$commit"
git -C "$repo_root" checkout --quiet --detach "$commit"
actual="$(git -C "$repo_root" rev-parse HEAD)"
if [[ "$actual" != "$commit" ]]; then
  printf 'upstream SHA mismatch: expected %s, got %s\n' "$commit" "$actual" >&2
  exit 1
fi

printf '%s\n' "$repo_root"
