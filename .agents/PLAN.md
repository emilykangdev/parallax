# Plan: <one-line headline — what this plan delivers>

Flavor: feature | bugfix | refactor   ·   Date: YYYY-MM-DD   ·   Brief: <path or "n/a">

A plan is the contract the implementer signs against. Everything below exists to prevent vibe code: parallel helpers, scope drift, narration comments, untested invariants, "while I'm here" rewrites. If a section feels like ceremony for *this* plan, write `n/a — <reason>` rather than leaving it blank or filling it with filler. Adapted from time-box's `.agents/PLAN.md`.

## Goal

<2–4 sentences. What concrete user-visible or system-visible change ships when this plan is done. State the smallest version that delivers the value — not the cleanest, not the most general.>

## Non-goals

<Explicit list of things this plan does **not** do, especially adjacent improvements the implementer might be tempted to fold in. Each line is a "no" the reviewer can hold the implementer to.>

- <Adjacent feature that looks related — call it out as deferred / out-of-scope.>
- <Refactor that's tempting while touching this code — out unless strictly required.>
- <Surface this plan does not extend to (e.g. "the Apple Shortcut spec stays as-is").>

## Why

<The motivating problem. What breaks or feels wrong today, who notices, which failure modes this resolves. Reference prior briefs / `tmp/ideas.md` decisions instead of re-litigating.>

1. **<Failure mode or unmet need 1>.** <Brief description.>
2. **<Failure mode or unmet need 2>.** <Brief description.>

## What

### User-visible behavior

- **<Surface — e.g. POST /api/render, /scratch gallery, the Shortcut>**: <what changes, when, the trigger.>
- **<Second surface>**: <same shape.>

### Technical requirements

- <New function / iii worker function / type to add, with file path. Justify why it can't reuse something in §Reuse inventory.>
- <Existing call sites or `config.yaml` entries to change (with file:line refs).>
- <Engine/SDK version implications — does this require a minor bump? If so, both engine and `iii-sdk` move together.>
- <Wiring: stream names, blob paths, auth function, RBAC expose_functions.>

### Success criteria

- [ ] <User-observable behavior 1.>
- [ ] <Edge case / format detail.>
- [ ] <Single-source-of-truth claim — "no other inline copies of X remain".>
- [ ] Each §Invariant below has a corresponding assertion in `scripts/smoke.ts`.
- [ ] `npm run ready` passes, and `npm run smoke` passes against a live stack.

## §Surface

What external state this implementation touches, and the failure mode if any touch goes wrong. §Surface is what's AT STAKE during; §Invariants is what must be TRUE after. One bullet per touch. Required for plans that add/change scripts, the engine config, deploys, ports, secrets, the Tailscale-exposed surface, or anything making claims about how other parts of the system behave. 5–10 bullets.

- **<Filesystem path — e.g. ./blob/out>** — read/write/create/delete; gitignored? accidental-commit risk?
- **<Port / listener — e.g. :3111 0.0.0.0>** — who can reach it (Tailscale? public?); what auth gates it; failure mode if the gate is wrong.
- **<Secret in flight — GEMINI_API_KEY / PARALLAX_TOKEN>** — argv vs env vs file vs log; where it could leak (`ps`, logs, the `/scratch` HTML).
- **<Gemini quota>** — does this add a code path that spends real quota? Is it gated behind auth and `?provider=fake`-testable?
- **<Source-of-truth semantics>** — additive vs replace for stream/blob state; state which and why.
- **<Claim about other code>** — what I'm asserting; file:line where it's grounded.

## §Invariants and Tests

Per AGENTS.md, plans touching auth, secrets, money (Gemini quota), async, persistent state, or user-visible behavior must specify invariants, not just steps — each with a test (an assertion in `scripts/smoke.ts` wherever the live surface can reach it). Put it in a table: Invariant | Test | Threat it closes | Enforced by.

| Invariant | Test | Threat it closes | Enforced by |
| --- | --- | --- | --- |
| <e.g. POST /api/render with no/wrong token → 401> | <smoke.ts negative-auth assert> | <unauthenticated quota burn> | <auth::bearer> |
| <e.g. browser token never grants render::create> | <smoke.ts WS + render assert> | <read token escalating to write> | <auth::browser RBAC> |

## All Needed Context

### Documentation & References

```yaml
- file: tmp/ideas.md
  why: <design canon this plan must obey; do not re-litigate>

- file: config.yaml
  why: <engine + worker wiring the change touches>

- file: workers/<worker>/src/<file>.ts
  lines: <range — verify still current at plan-write time>
  why: <what lives here and why the implementer needs it>
```

### Reuse inventory

Existing primitives the implementer **must** reuse rather than recreate — heads off parallel helpers, duplicated types, re-derived constants. If something here ends up unused, that's a signal to reconsider the approach, not to silently invent a sibling.

- **<existing function>** at `<file:lines>` — use for <what>. Don't write a sibling.
- **<existing type>** at `<file:lines>` — import/extend; don't redeclare.
- **<existing stream name / blob path constant>** at `<file:lines>` — read; don't inline a copy.

### Known gotchas

```typescript
// 1. iii-stream dedupes on item_id — reuse the render id so retries are idempotent.
// 2. /scratch is served raw HTML; an ApiResponse wrapper would JSON-quote it (0.18 regression).
// 3. <off-by-one / content-type / port trap specific to this change>
```

### Considered and rejected

- **<Alternative 1>.** Rejected because <reason — a principle, a past incident, or a measurable cost>.

## Files Being Changed

```
workers/<worker>/src/
├── <NewFile.ts>        ← NEW       (<one-line purpose>)
├── <ModifiedFile.ts>   ← MODIFIED  (<one-line summary>)
config.yaml             ← MODIFIED  (<…>)
scripts/smoke.ts        ← MODIFIED  (<new invariant assertions>)
```

<If NEW files climb past ~6, stop — that usually means the plan is doing two things, or something on §Reuse inventory was overlooked.>

## Architecture Overview

<ASCII diagram of the data/control flow: Shortcut → POST /api/render → bus → provider → blob → stream → /scratch. Mark who reads vs writes.>

## Tasks (in implementation order)

Each task is commit-sized: one concern, one verification step, leaves the tree typechecking.

- [ ] **Task 1 — <verb-led title>.** <What changes; which file(s).>
  - Verify: <typecheck / smoke assert / grep that confirms this task alone.>
- [ ] **Task N — Diff hostility pass.** Re-read the full diff. Delete narration comments, single-use helpers, dead branches, leftover imports, tombstones. AGENTS.md "Minimal Changes / No Slop" applies.

## Final Validation Checklist

```bash
npm run ready                      # static gate (typecheck + guards)
npm run smoke                      # live gate — engine + both workers must be up
git diff <base>...HEAD             # diff hostility — cut anything unneeded
```

- [ ] All §Invariants have a passing assertion.
- [ ] No `as any` / `as unknown as X` / `@ts-ignore` / `@ts-expect-error` introduced.
- [ ] No narration comments, no commented-out code, no single-use helpers.
- [ ] Every file in §Files Being Changed actually changed.

## Open questions

Known unknowns the implementer must surface (ask the user) rather than guess. `n/a` if none. Not a parking lot for future work — that goes in §Non-goals.

- <Ambiguity — what's unclear, and what to do if it comes up mid-implementation.>
