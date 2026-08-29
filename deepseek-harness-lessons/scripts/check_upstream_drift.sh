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

# Re-verify every lesson's anchors (paths, symbols, source comments) against
# the real checkout.  Each lesson's code.ts exits non-zero on a broken anchor,
# so upstream drift becomes loud instead of silently stale course material.
node_bin="$(command -v node)"
drift_failed=0
for lesson_code in "$course_root"/[0-9][0-9]_*/code.ts; do
  if ! DSH_SOURCE_DIR="$repo_root" "$node_bin" --experimental-strip-types "$lesson_code" >/dev/null 2>"$course_root/.drift-lesson.err"; then
    printf 'ANCHOR DRIFT in %s:\n' "${lesson_code#"$course_root"/}"
    sed 's/^/    /' "$course_root/.drift-lesson.err"
    drift_failed=1
  fi
done
rm -f "$course_root/.drift-lesson.err"

if [[ "$drift_failed" -ne 0 ]]; then
  printf 'FAIL: lesson anchors drifted from the locked snapshot\n' >&2
  exit 1
fi

printf 'lesson anchors: ok (verified against %s)\n' "$commit"
