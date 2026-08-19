#!/usr/bin/env bash
set -euo pipefail

course_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
lock_file="$course_root/upstream.lock.json"
manifest="$course_root/source-manifest.json"
cache_root="${DSH_ADVANCED_CACHE_DIR:-${TMPDIR:-/tmp}/deepseek-harness-advanced-course}"
repo_root="$cache_root/source"

[[ -d "$repo_root/.git" ]] || { printf 'upstream checkout is absent; run prepare_upstream.sh first\n' >&2; exit 2; }
commit="$(node -e 'const fs=require("fs"); const x=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(x.commit)' "$lock_file")"
actual="$(git -C "$repo_root" rev-parse HEAD)"
printf 'locked commit: %s\ncheckout commit: %s\n' "$commit" "$actual"
[[ "$actual" == "$commit" ]] || { printf 'FAIL: checkout is not on the locked commit\n' >&2; exit 1; }

missing=0
while IFS= read -r path; do
  if [[ ! -e "$repo_root/$path" ]]; then
    printf 'MISSING: %s\n' "$path"
    missing=1
  fi
done < <(node -e 'const fs=require("fs"); const x=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); for (const e of x.entries) for (const p of e.paths) console.log(p)' "$manifest")

[[ "$missing" -eq 0 ]] || { printf 'FAIL: source manifest drifted\n' >&2; exit 1; }

node -e '
  const fs = require("fs")
  const path = require("path")
  const [manifestPath, repoRoot] = process.argv.slice(1)
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"))

  function collectFiles(target, files) {
    const stat = fs.statSync(target)
    if (stat.isFile()) {
      files.push(fs.readFileSync(target))
      return
    }
    if (!stat.isDirectory()) return
    for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue
      collectFiles(path.join(target, entry.name), files)
    }
  }

  const missing = []
  for (const entry of manifest.entries) {
    const files = []
    for (const sourcePath of entry.paths) collectFiles(path.join(repoRoot, sourcePath), files)
    for (const symbol of entry.symbols) {
      const needle = Buffer.from(symbol)
      if (!files.some((file) => file.includes(needle))) missing.push(`lesson ${entry.lesson}: ${symbol}`)
    }
  }
  if (missing.length > 0) {
    for (const symbol of missing) console.error(`MISSING SYMBOL: ${symbol}`)
    process.exit(1)
  }
' "$manifest" "$repo_root"

printf 'source manifest: ok (paths and symbols)\n'
