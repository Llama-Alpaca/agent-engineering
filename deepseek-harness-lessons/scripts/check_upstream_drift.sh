#!/usr/bin/env bash
set -euo pipefail

course_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
lock_file="$course_root/upstream.lock.json"
cache_root="${DSH_COURSE_CACHE_DIR:-${TMPDIR:-/tmp}/deepseek-harness-course}"
repo_root="$cache_root/source"

if [[ ! -d "$repo_root/.git" ]]; then
  printf 'upstream checkout is absent; run prepare_upstream.sh first\n' >&2
  exit 2
fi

commit="$(node -e 'const fs=require("fs"); const x=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(x.commit)' "$lock_file")"
actual="$(git -C "$repo_root" rev-parse HEAD)"
printf 'locked commit: %s\ncheckout commit: %s\n' "$commit" "$actual"
if [[ "$actual" != "$commit" ]]; then
  printf 'FAIL: checkout is not on the locked commit\n' >&2
  exit 1
fi

manifest="$course_root/source-manifest.json"
missing=0
while IFS= read -r path; do
  if [[ ! -e "$repo_root/$path" ]]; then
    printf 'MISSING: %s\n' "$path"
    missing=1
  fi
done < <(node -e 'const fs=require("fs"); const x=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); for (const e of x.entries) for (const p of e.paths) console.log(p)' "$manifest")

if [[ "$missing" -ne 0 ]]; then
  printf 'FAIL: source manifest drifted\n' >&2
  exit 1
fi

printf 'source manifest: ok\n'
