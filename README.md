# parallax

Sketch anything on the iPad in Freeform, share it to a Shortcut, and get back a
polished comic-style version — with a live gallery of every render. Built on
[iii.dev](https://iii.dev): one engine + a few workers, no bespoke server/DB/blob stack.

v0a is the smallest useful loop. Plan: `tmp/ready-plans/2026-05-18-parallax-v0a-iii.md`
(moves to `tmp/done-plans/` once shipped). Design canon: `tmp/ideas.md`.

## Layout

```
config.yaml                 engine + built-in workers (iii-http, iii-stream, …)
workers/provider-gemini     provider::gemini::render  (Gemini 2.5 Flash Image via @google/genai)
workers/parallax-render     render::create/list/image, gallery::page, auth::bearer
shortcuts/                  Apple Shortcut spec
blob/{in,out}               source + polished PNGs (gitignored)
data/                       iii-stream file adapter (gitignored)
```

## Secrets (dotenvx-ops)

Secrets are encrypted at rest in `.env` (ciphertext + a public key — the file is
committed). Private keys never touch disk: they live in your **dotenvx-ops** login
(armored cloud keys), fetched at runtime to decrypt. So nothing sensitive is pasteable
into the repo or readable by an agent.

```bash
curl -sfS https://dotenvx.sh/ops | sh    # once — install dotenvx-ops
dotenvx-ops login                         # once — armored keys live in your Ops account
npm install                               # root: installs dotenvx + tooling

# set + encrypt each secret in place (rewrites the line as encrypted:…):
npx dotenvx set GEMINI_API_KEY <value> -f .env
npx dotenvx set PARALLAX_TOKEN  <value> -f .env
```

Local-only plaintext overrides (never committed) go in `.env.local`.

## Run (local)

Prereqs: the `iii` engine on the **0.16.x** line (the SDKs are pinned to `0.16.1`;
keep them on the same minor). Upgrade with `iii update` if needed.

```bash
iii worker add iii-worker-manager   # once — enables browser connections
iii --config config.yaml            # start the engine + built-in workers

# each worker is its own process; the scripts wrap it in `dotenvx run` so the
# decrypted env is injected (run from the repo root so ./blob + ./data resolve):
npm run dev:gemini                  # provider-gemini worker
npm run dev:render                  # parallax-render worker
```

Smoke-test the raw round-trip:

```bash
curl -X POST "http://localhost:3111/api/render?caption=test" \
  -H "Authorization: Bearer $PARALLAX_TOKEN" \
  --data-binary @test-sketch.png -o out.png && open out.png   # response IS the PNG
open http://localhost:3111/scratch                            # live gallery
```

Then build the Apple Shortcut (`shortcuts/parallax-render.shortcut.md`) against your
Tailscale hostname or public URL.

## Typecheck

```bash
npm run typecheck            # both workers (tsc --noEmit)
```
