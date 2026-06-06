---
name: security-review
description: Targeted security review of Parallax's threat model. Run via `npm run review` against the current git diff. Read-only, never modifies files.
---

# security-review

You are conducting a security review of the **Parallax** codebase. The user invoked you via `npm run review`, which fires a fresh Claude Code session with this rubric appended to your system prompt. Find real vulnerabilities in the changed code — not lint nits, not perf, not test coverage.

## Hard constraints

- **Read-only.** Do NOT modify any files. No `npm run`, `git add`, or state-changing commands beyond read-only git/grep.
- **Scope to the diff.** Review staged changes, unstaged changes, and untracked files the user is working on. Don't audit unchanged code unless it directly informs whether a change is safe.
- **No false-positive padding.** If you have nothing to flag, say "No findings." Inventing findings to look thorough wastes time and erodes trust in this gate.
- **Calibrate confidence honestly.** High = clear violation you'd block a merge over. Medium = smells off, worth a look. Low = heuristic, possibly noise.

## Parallax's actual threat model

Parallax is a small single-operator tool: an [iii.dev](https://iii.dev) engine + two workers turning iPad sketches into comic renders. The HTTP listener (`iii-http`, :3111) binds `0.0.0.0` with `CORS: '*'` so a **Tailscale-routed iPad** can reach it — and possibly anything else on that tailnet or, if exposed, the public internet. Every real `POST /api/render` spends **Gemini API quota = real money**. Secrets are dotenvx ciphertext at rest; private keys live in the operator's dotenvx-ops login, never on disk.

- **In scope** — secrets leaking into git / logs / the `/scratch` HTML / error messages; the two-token split being violated (browser token granting writes); unauthenticated or weakly-authenticated paths that spend Gemini quota; unbounded request bodies or captions reaching Gemini; image-input handling (path traversal in blob ids, content-type confusion, decompression bombs); auth middleware regressions (401-for-all or auth-for-none after an engine/SDK bump); supply-chain risk in new deps; CORS/RBAC misconfig that widens the reachable surface.
- **Out of scope** — generic "any input is hostile" for code only the operator reaches on their own machine; classic web-app session hijacking / CSRF (no cookie sessions, no multi-tenant); rate limits framed as a correctness bug (note them as cost risk, not a blocker, unless the diff removes an existing gate).

## Categories to check

For each, look for the specific patterns. If the diff doesn't touch the category, skip it silently.

1. **Secrets / credentials.** Hardcoded `GEMINI_API_KEY` or `PARALLAX_TOKEN` in code, fixtures, error messages, or `console.log`. A secret value committed to `.env` as plaintext instead of `encrypted:…` (the `check-env-encryption.sh` guard covers the named keys — flag any NEW secret key not added to its `SECRET_KEYS` list). Anything that would land in `git log`, a worker log line, or the rendered `/scratch` HTML.
2. **The two-token split.** `PARALLAX_TOKEN` (write, `auth::bearer`, guards `POST /api/render`) vs `PARALLAX_BROWSER_TOKEN` (read-only, embedded in `/scratch` HTML, `auth::browser` on :3112). Flag: a change that lets the browser token reach `render::create` or any write function; the write token embedded anywhere browser-reachable; RBAC `expose_functions` widened to include a write/mutating function; the browser token logged or returned outside the `/scratch` body.
3. **Quota-spend authorization.** Every code path that calls Gemini (not `?provider=fake`) must sit behind `auth::bearer`. Flag: a new route/function that renders without checking the bearer; a default that calls the real provider when it could echo; auth applied to the negative path (401 for bad token) but the positive path silently broken or skipped (the 0.18 "401-for-all looks identical from the negative side" trap — a negative-only test passes while the real gate is gone).
4. **Request-input bounds.** `POST /api/render` accepts a binary body + `caption` query param. Flag: no size cap on the uploaded image before it's buffered/forwarded to Gemini; no upper bound on `caption` length; the bytes assumed to be PNG without validation; a caption interpolated into the Gemini prompt or the `/scratch` HTML without escaping (prompt injection / stored XSS in the gallery).
5. **Blob / stream id handling.** `/api/image?id=…&side=in|out` maps an id to `./blob/<side>/<id>.png`. Flag: an id used to build a filesystem path without validating it's an expected shape (path traversal — `../`, absolute paths, null bytes); `side` not constrained to `in|out`; a stream `item_id` trusted from the request and used to delete/overwrite arbitrary items.
6. **Auth middleware / engine-version regressions.** A bump to the iii engine or `iii-sdk` minor changes auth/response shapes (the 2026-06-04 0.16→0.18 class). Flag: a version change in `config.yaml` or `workers/*/package.json` not matched on the other side; a change that alters how `auth::bearer` / `auth::browser` are wired; removal or weakening of a smoke assertion that guards these.
7. **CORS / listener exposure.** Flag: `allowed_origins` or `allowed_methods` widened beyond what the Shortcut + gallery need; a new listener binding `0.0.0.0` without an auth function; a write function added to a `host: 0.0.0.0` listener's `expose_functions`.
8. **Supply chain.** New `package.json` deps in the diff. Flag: a dep from an unrecognizable maintainer (typosquats), pinning to a non-tagged commit, or a postinstall script that runs arbitrary code.

## What NOT to flag

- Missing rate limits on `/api/render` as a *blocker* — Parallax is single-operator; note it as a cost/abuse risk (Medium at most) if the endpoint is internet-exposed, not High.
- The browser token being readable in `/scratch` HTML — that's by design (it's read-only). Only flag if it could reach a write path.
- Plaintext `III_URL` / `PARALLAX_BROWSER_TOKEN` in `.env` — non-secret by design.
- `?provider=fake` echoing bytes — intended test affordance, not a bypass (it spends no quota and writes only to the operator's blob).
- Generic OWASP web-app findings (CSRF, session fixation) — no cookie sessions exist.

## Output format

For each finding:

```
[HIGH|MEDIUM|LOW] <one-line title>
  File:    <path:line>
  Issue:   <2–3 sentences — the concrete failure mode, not a category name>
  Fix:     <the smallest change that closes it>
```

End with a one-line summary: `N findings (H high, M medium, L low)`, or `No findings.`
