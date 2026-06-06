#!/usr/bin/env bash
# Fire a fresh-context security review against the current git working state.
# Read-only; never modifies files. Uses the Claude Code CLI in headless (-p)
# mode under your existing Max plan — no API key required.
#
# The rubric lives at .agents/skills/security-review/SKILL.md and is appended
# to the system prompt, so a freshly-spawned session has the full instructions
# without inheriting context from wherever this was invoked. Borrowed from
# time-box's scripts/review.sh.

set -euo pipefail

REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
RUBRIC="$REPO_ROOT/.agents/skills/security-review/SKILL.md"

if [ ! -f "$RUBRIC" ]; then
  echo "Rubric not found: $RUBRIC" >&2
  echo "Expected the security-review skill at .agents/skills/security-review/SKILL.md" >&2
  exit 1
fi

if ! command -v claude >/dev/null 2>&1; then
  echo "claude CLI not on PATH — install Claude Code, then re-run." >&2
  exit 1
fi

# CWD intentionally NOT changed — claude inherits this shell's pwd, so the
# review scopes to whichever checkout you invoked from.
claude -p "$(cat <<'EOF'
Run a security review against the current git working state in this directory.

Scope:
- Staged changes:    git diff --cached --name-only
- Unstaged changes:  git diff --name-only
- Untracked files:   git ls-files --others --exclude-standard

Follow the rubric in your system prompt exactly. Read-only — do not modify any files. Output the report in the exact format the rubric specifies. If no findings, say "No findings."
EOF
)" --append-system-prompt "$(cat "$RUBRIC")"
