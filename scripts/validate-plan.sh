#!/usr/bin/env bash
# Borrowed from time-box. Asserts a plan file carries an §Invariants section —
# the one structural property .agents/PLAN.md requires for any plan touching
# auth, secrets, money, async, persistent state, or user-visible behavior.
set -euo pipefail

# Assign on its own line so `set -e` aborts if git fails (not a repo). A bare
# `cd "$(git ...)"` would `cd ""` (no-op, exit 0) and silently run in the
# inherited cwd instead of the repo root.
root=$(git rev-parse --show-toplevel)
cd "$root"

if [ "$#" -eq 0 ]; then
  echo "usage: scripts/validate-plan.sh <plan.md> [plan.md ...]" >&2
  exit 2
fi

missing=0
for plan_path in "$@"; do
  if [ ! -f "$plan_path" ]; then
    echo "FAIL $plan_path: file not found" >&2
    missing=1
    continue
  fi

  if grep -Eiq '^[[:space:]]*#+[[:space:]]*(§[[:space:]]*)?invariants' "$plan_path"; then
    echo "OK $plan_path: invariants section found"
  else
    echo "FAIL $plan_path: missing '## §Invariants' heading" >&2
    missing=1
  fi
done

exit "$missing"
