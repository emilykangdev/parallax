#!/usr/bin/env bash
# Single readiness gate. Run before declaring any task done, and fired
# automatically by .husky/pre-commit before every commit.
#
# Borrowed from time-box's scripts/ready.sh, trimmed to Parallax's shape:
# no workspaces, no eslint/prettier — two iii workers plus a smoke test.
#
# DELIBERATELY STATIC. Every step here runs WITHOUT a live iii engine: tmp
# guard, .env secret-encryption guard, AGENTS.md line cap, typecheck. The
# smoke test (npm run smoke) needs the engine + both workers + tokens running,
# so it is NOT folded in here — a pre-commit hook that depended on a live stack
# would either block every commit when the stack is down, or skip-on-stack-down
# (which violates the fail-loud-never-skip rule in CLAUDE.md). Smoke stays a
# separate, explicit live gate. Order is fail-fast, cheapest-first.

set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

step() { echo ""; echo "→ $1"; }
fail() { echo ""; echo "✗ NOT READY: $1"; exit 1; }

# 1. Hygiene — fastest, fail loudest.
step "1/4  No tmp/ files staged"
if git diff --cached --name-only | grep -q '^tmp/'; then
  fail "tmp/ files are staged — unstage them. (tmp/ is scratch, never committed.)"
fi
echo "  ok"

# 2. Secrets — refuse to land a secret key that isn't dotenvx ciphertext.
step "2/4  No plaintext secrets in staged .env files"
bash scripts/check-env-encryption.sh

# 3. Agent-doc size cap — keep AGENTS.md (and CLAUDE.md, if any) lean enough
#    to actually fit in context. Same 200-line bar time-box uses.
step "3/4  .agents/AGENTS.md + CLAUDE.md size cap (≤200 lines)"
for f in .agents/AGENTS.md CLAUDE.md; do
  [ -f "$f" ] || continue
  lines=$(wc -l < "$f" | tr -d ' ')
  if [ "$lines" -gt 200 ]; then
    fail "$f is $lines lines (cap: 200). Prune."
  fi
  echo "  $f: $lines lines"
done

# 4. Types — both workers (tsc --noEmit), the real signature-drift gate.
step "4/4  Typecheck (both workers)"
npm run --silent typecheck

echo ""
echo "✓ READY  (smoke not included — run 'npm run smoke' against a live stack)"
