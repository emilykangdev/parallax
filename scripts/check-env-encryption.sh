#!/usr/bin/env bash
# Refuse to commit a Parallax SECRET whose value isn't dotenvx ciphertext.
#
# Parallax's .env is COMMITTED on purpose (ciphertext + public key only — see
# README §Secrets). Unlike time-box, parallax's .env also carries non-secret
# config in PLAINTEXT by design (III_URL, PARALLAX_BROWSER_TOKEN — the browser
# token is embedded in the /scratch HTML anyway). So we can't require every
# line to be encrypted. Instead we name the keys that MUST be `encrypted:…`
# and fail if any of them is staged as plaintext — the exact failure mode of a
# `dotenvx set` that didn't take, or a raw key pasted in by hand.
#
# Scans the STAGED blob (not the working tree). Only key NAMES are printed on
# failure, never values. Bypass with `git commit --no-verify` (e.g. when fixing
# this guard itself).

set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

# Keys that must never land as plaintext. Add a key here the moment it becomes
# a real secret (e.g. a new provider API key).
SECRET_KEYS=(
  GEMINI_API_KEY
  PARALLAX_TOKEN
)

fail=0
while IFS= read -r file; do
  [ -n "$file" ] || continue
  base="${file##*/}"
  case "$base" in
    .env*) ;;
    *) continue ;;
  esac
  # Plaintext is expected in the template and in dev-only local overrides
  # (.env.local is gitignored; listed here as defense-in-depth if force-added).
  case "$base" in
    .env.example | .env.sample | .env.template | .env.local) continue ;;
  esac

  staged="$(git show ":$file")"
  for key in "${SECRET_KEYS[@]}"; do
    # Match a real assignment line for this key (ignore comments/blanks).
    line="$(printf '%s\n' "$staged" | grep -E "^[[:space:]]*${key}=" || true)"
    [ -n "$line" ] || continue
    value="${line#*=}"
    case "$value" in
      encrypted:*) ;;                       # good — dotenvx ciphertext
      "" ) ;;                               # empty (template-like) — not a leak
      *)
        echo "✗ $file  $key is plaintext (expected ${key}=encrypted:…)"
        fail=1
        ;;
    esac
  done
done < <(git diff --cached --name-only --diff-filter=ACMR)

if [ "$fail" -ne 0 ]; then
  echo ""
  echo "✗ Refusing to commit a plaintext secret. Re-encrypt with:"
  echo "    npx dotenvx set <KEY> <value> -f .env"
  echo "  then re-stage. Bypass (rare) with: git commit --no-verify"
  exit 1
fi
echo "  ok"
