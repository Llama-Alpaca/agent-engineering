#!/usr/bin/env bash
# Verify every course anchor against the pinned upstream checkout.
# The checkout comes from prepare_upstream.sh (or set DSH_SOURCE_DIR yourself).
set -euo pipefail
course_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
lock_file="$course_root/upstream.lock.json"
cache_root="${DSH_COURSE_CACHE_DIR:-${TMPDIR:-/tmp}/deepseek-harness-course}"
repo_root="$cache_root/source"

if [[ -n "${DSH_SOURCE_DIR:-}" ]]; then
  repo_root="$DSH_SOURCE_DIR"
elif [[ ! -d "$repo_root/.git" ]]; then
  printf 'upstream checkout is absent; run prepare_upstream.sh or set DSH_SOURCE_DIR\n' >&2
  exit 2
fi

commit="$(node -e 'const fs=require("fs"); const x=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(x.commit)' "$lock_file")"
actual="$(git -C "$repo_root" rev-parse HEAD)"
printf 'locked commit: %s\ncheckout commit: %s\n' "$commit" "$actual"
if [[ "$actual" != "$commit" ]]; then
  printf 'FAIL: checkout is not on the locked commit\n' >&2
  exit 1
fi

DSH_SOURCE_DIR="$repo_root" node --experimental-strip-types "$course_root/scripts/check_anchors.ts"
