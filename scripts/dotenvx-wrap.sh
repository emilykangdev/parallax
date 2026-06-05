#!/usr/bin/env bash
# Wrap a command in dotenvx with explicit precedence:  shell > .env.local > .env
#
# `.env` is committed and encrypted (ciphertext + DOTENV_PUBLIC_KEY only — safe to
# track). `.env.local` is optional, gitignored, plaintext local overrides.
#
# Private keys are NOT on disk: they live in your dotenvx-ops login (armored cloud
# keys). dotenvx fetches them at runtime to decrypt. Nothing sensitive is ever
# written in plaintext where it could be committed or read by an agent.
#
# --strict turns a decryption failure (e.g. not logged into dotenvx-ops → no private
# key) into a hard non-zero exit, instead of silently exec'ing the command with
# literal `encrypted:...` strings in process.env.
# --ignore=MISSING_ENV_FILE keeps `.env.local` optional even under --strict.
#
# NOTE: @dotenvx/dotenvx is pinned EXACTLY to 1.65.2 in package.json. 1.69.2 has a
# regression where `--strict` + `-f` aborts the armored-key fetch ("unknown option
# '-f'" → MISSING_PRIVATE_KEY). Verified broken 2026-06-04; check that --strict
# still decrypts before bumping the pin.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

if [ ! -f .env ]; then
  echo "ERROR: .env is missing. See .env.example for the required keys." >&2
  echo "Onboarding:" >&2
  echo "  1. curl -sfS https://dotenvx.sh/ops | sh" >&2
  echo "  2. dotenvx-ops login" >&2
  echo "  3. pull the tracked encrypted .env, or set values yourself:" >&2
  echo "       npx dotenvx set GEMINI_API_KEY <value> -f .env" >&2
  echo "       npx dotenvx set PARALLAX_TOKEN <value> -f .env" >&2
  exit 1
fi

exec npx dotenvx run --strict -f .env.local -f .env --ignore=MISSING_ENV_FILE -- "$@"
