#!/usr/bin/env bash
# Course-level checks: anchors.json consistency + validator behavior (keyless, deterministic).
set -euo pipefail
course_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

printf '== course 12: anchor checks (keyless) ==\n'
node --experimental-strip-types "$course_root/scripts/check_anchors.ts"

printf '== course 12: tests/check.test.ts ==\n'
node --experimental-strip-types "$course_root/tests/check.test.ts"

printf 'course 12 tests: ok\n'
