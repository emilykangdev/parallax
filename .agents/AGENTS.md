# Overview

Parallax is a **sketch → polished comic render loop** built on [iii.dev](https://iii.dev):
one engine + a few workers, no bespoke server/DB/blob stack. Sketch on the iPad in
Freeform → share to an Apple Shortcut → `POST /api/render` → Gemini 2.5 Flash Image →
polished PNG back + a live gallery at `/scratch`.

Cross-agent rules live here so every agent (Claude Code, Codex, …) reads the same
contract. Claude-Code-only glue lives under `.claude/`.

## Layout

```
config.yaml                 iii engine + built-in workers (iii-http :3111, browser RBAC :3112, iii-stream, …)
workers/provider-gemini     provider::gemini::render  (Gemini via @google/genai)
workers/parallax-render     render::create/list/image, gallery::page, auth::bearer + auth::browser
shortcuts/                  Apple Shortcut spec
blob/{in,out}               source + polished PNGs (gitignored)
data/                       iii-stream file adapter (gitignored)
scripts/                    ready.sh (gate), check-env-encryption.sh, smoke.ts, review.sh, validate-plan.sh
.agents/                    this file, PLAN.md, skills/ (cross-agent)
```

# AI Coding Rules

- **Plans go in `tmp/ready-plans/`** (moves to `tmp/done-plans/` once shipped). `tmp/` is
  always gitignored — never commit it. Design canon lives in `tmp/ideas.md`; read it before
  proposing UI/UX or product changes and treat it as binding, not a starting point.
- **The `mermaids/` folder convention is THE contract** for codebase comprehension — the user
  authors, the AI scaffolds. Don't restructure that loop without asking.
- **If a doc contradicts the code, ask before acting on either side** — don't silently "fix" one
  to match the other.
- **Prefer inline code over a helper unless used in 2+ places.** Reject plugin systems, strategy
  patterns, and unused generics. When two approaches both work, take the one with fewer moving
  parts — easier to delete later. The clever/general version earns its place only when the simple
  one is actually wrong (incorrect, or too slow at real scale), not merely longer.
- **Plans touching auth, secrets, money (Gemini quota), async, persistent state (streams/blob),
  or user-visible behavior must include an explicit `## §Invariants` section** (5–10 lines, each
  with a test). See `.agents/PLAN.md`. `scripts/validate-plan.sh` enforces the heading.
- **Plans that add/change scripts, the engine config, or anything mutating ambient state** (cwd,
  secrets, ports, filesystem outside the repo, Tailscale exposure) must include a `## §Surface`
  section: one bullet per external touch + the failure mode if that touch is wrong.
- When you respond to the user, use correct English grammar.

## The iii.dev seam

- **Keep the engine and the SDKs on the same minor.** `config.yaml` targets a specific iii line;
  `workers/*/package.json` pin `iii-sdk` to a matching minor. A mismatch is the regression class
  that bit us on 2026-06-04 (0.16→0.18: `/scratch` served JSON-quoted, auth middleware shape
  change → 401-for-all, browser RBAC listener missing). If you bump one, bump both, and re-run
  `npm run smoke` — it asserts that whole class.
- **Two auth surfaces, never conflated.** `PARALLAX_TOKEN` is the write bearer guarding
  `POST /api/render` (`auth::bearer`). `PARALLAX_BROWSER_TOKEN` is read-only, embedded in the
  `/scratch` HTML, gating the browser WS listener (`auth::browser`, :3112). The browser token must
  **never** grant `render::create`. Keep them separate; don't reuse one for the other.
- **The HTTP listener binds `0.0.0.0` with `CORS: '*'`** so a Tailscale-routed iPad can reach it.
  Bearer auth is the only gate on the write path — treat `POST /api/render` as internet-reachable
  when reasoning about abuse and cost (every real render spends Gemini quota).
- **`?provider=fake`** echoes the sketch bytes without calling Gemini — use it for any test that
  exercises the full HTTP → bus → blob → stream → list path without burning quota.

# Minimal Changes / No Slop

AI-generated code accumulates: narration comments, single-use helpers, dead code from earlier
iterations, error handling for cases that can't happen. Before declaring done, re-read your own
diff with a hostile eye and cut everything the current implementation doesn't need.

- **Re-read the diff end-to-end before finishing.** Delete replaced functions, unused imports,
  stale branches, helpers nothing calls anymore. Git has the history; the codebase doesn't need a
  tombstone.
- **No narration comments.** Don't explain WHAT (names do that) or reference the task ("added for
  X", "used by Y"). Only comment when the WHY is non-obvious: a hidden constraint, a workaround, a
  surprising invariant.
  - ✗ `// Loop through renders and push to the stream`
  - ✓ `// iii-stream dedupes on item_id — reuse the render id so a retry is idempotent`
- **No commented-out code, no "removed X" tombstones, no backwards-compat shims** for code you
  just deleted in the same change.
- **No single-use abstractions.** Don't create a helper/wrapper until a second caller exists.
  Three similar lines beats a premature abstraction.
- **No speculative error handling — validate only at true boundaries.** The real boundaries are the
  HTTP handler seam (untrusted request body/query), the Gemini API response, and untyped env vars.
  Trust internal, typed callers. Model expected failures as return values, not throws-and-recatch.
- **Frontend caveat:** the `/scratch` gallery is where slop compounds fastest — dead conditional
  branches, unused state, stale styles. Read the template top-to-bottom against the current design
  before declaring done. For any non-trivial UI work, use the `frontend-design` skill.

# TypeScript

- **No casting** except `as const`. No `as any`, `as unknown as X`, `@ts-ignore`,
  `@ts-expect-error`. Fix the type instead.
- **No magic strings/numbers.** Runtime string sets (function ids, stream names, status values) →
  an `as const` object. Closed string sets / discriminants → a `type` union. Numeric constants with
  an implicit unit carry a suffix (`_MS`, `_BYTES`, `_PX`) — no bare `60000` for a timeout.
- **Named constants:** one consumer → inline `UPPER_SNAKE` at module top; 2+ consumers → export
  from the owning module, never a catch-all `constants.ts`.
- `npm run typecheck` (both workers, `tsc --noEmit`) must pass before committing.

# Quality Gates

Before declaring a task done, run:

```
npm run ready
```

The single readiness gate (`scripts/ready.sh`), fail-fast cheapest-first: tmp/-not-staged guard →
staged `.env` secret-encryption guard → AGENTS.md/CLAUDE.md ≤200-line cap → typecheck (both
workers). It is **deliberately static** — every step runs without a live iii engine, so it's safe
in a pre-commit hook.

**Smoke is a separate, live gate.** `npm run smoke` asserts the whole v0a surface against a
RUNNING stack (engine + both workers + tokens) and **fails hard** if a prerequisite is missing — no
skip-on-missing-env. Run it after `npm run ready` whenever the stack is up, and always before
shipping. It is intentionally NOT inside `ready` (a pre-commit hook can't assume the engine is up).

## On-demand security review

```
npm run review
```

Spawns a fresh-context Claude Code session (`claude -p`, read-only, Max plan — no API key) that
audits the current git diff against `.agents/skills/security-review/SKILL.md` — Parallax's actual
threat model (secrets, the exposed render endpoint, the two-token split, Gemini-quota abuse,
prompt/image-input handling, supply chain). A fresh session isn't biased by the conversation that
produced the code. Run it before shipping anything touching auth, the render path, or secrets.

# Automated guardrails

**Per-commit (Husky, every agent + human).** `.husky/pre-commit` runs `npm run ready` before any
`git commit` lands locally. Husky wires this automatically — `npm install` runs `prepare: husky`,
pointing `git config core.hooksPath` at `.husky/_`. No setup beyond `npm install`. Bypass with
`git commit --no-verify` only when fixing the gate itself.

- **Secret-encryption guard** (`scripts/check-env-encryption.sh`, inside `ready`): refuses to
  commit a staged secret key (`GEMINI_API_KEY`, `PARALLAX_TOKEN`) whose value isn't
  `encrypted:…`. Parallax's `.env` carries non-secret config in plaintext by design
  (`III_URL`, `PARALLAX_BROWSER_TOKEN`), so the guard targets the named secret keys, not every
  line. Add a key to `SECRET_KEYS` the moment it becomes a real secret.
