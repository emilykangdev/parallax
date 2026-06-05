// Parallax smoke test — asserts the whole v0a surface against a RUNNING stack
// (engine + provider-gemini + parallax-render). Run: npm run smoke
//
// Philosophy (per CLAUDE.md): every check FAILS HARD. No skip-on-missing-env,
// no "warning, continuing". A green run means every assertion actually ran.
// The render check uses ?provider=fake (echo provider) so the FULL positive
// path — HTTP → bus → blob → stream → list — runs without Gemini quota.
//
// Catches the entire 0.16→0.18 regression class we hit on 2026-06-04:
//   - /scratch served as JSON-quoted string  → content-type + doctype asserts
//   - auth middleware shape change (401-for-all) → positive-path 200 assert
//   - browser RBAC listener missing → ws connect assert
import { execSync } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'

const BASE = process.env.PARALLAX_BASE_URL ?? 'http://localhost:3111'
const WS_PORT = 3112 // browser RBAC listener (config.yaml)
// 1x1 transparent PNG
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

let n = 0
const ok = (name: string) => console.log(`  ✓ ${++n} ${name}`)
const fail = (name: string, detail: string): never => {
  console.error(`  ✗ ${name}\n    ${detail}`)
  process.exit(1)
}
const assert = (cond: unknown, name: string, detail: string) => (cond ? ok(name) : fail(name, detail))

// --- 0. prerequisites are HARD requirements, not skip conditions ---
const TOKEN = process.env.PARALLAX_TOKEN
const BROWSER_TOKEN = process.env.PARALLAX_BROWSER_TOKEN
if (!TOKEN) fail('env', 'PARALLAX_TOKEN required — this test does not skip')
if (!BROWSER_TOKEN) fail('env', 'PARALLAX_BROWSER_TOKEN required — this test does not skip')

const smokeCaption = `smoke-${Date.now()}`

const main = async () => {
  // --- 1. /scratch is real HTML (catches the 0.18 ApiResponse JSON-encoding regression) ---
  const scratch = await fetch(`${BASE}/scratch`).catch((e) => fail('/scratch reachable', String(e)))
  assert(scratch.status === 200, '/scratch 200', `got ${scratch.status}`)
  const ct = scratch.headers.get('content-type') ?? ''
  assert(ct.startsWith('text/html'), '/scratch content-type text/html', `got "${ct}"`)
  const html = await scratch.text()
  assert(html.startsWith('<!doctype html'), '/scratch body is raw HTML, not JSON-quoted', html.slice(0, 40))
  assert(!html.includes('__BROWSER_TOKEN__'), '/scratch browser token injected', 'placeholder still present')

  // --- 2. /api/renders is a JSON array ---
  const list0 = await fetch(`${BASE}/api/renders`)
  assert(list0.status === 200, '/api/renders 200', `got ${list0.status}`)
  const rows0 = await list0.json()
  assert(Array.isArray(rows0), '/api/renders returns array', typeof rows0)

  // Sweep debris from previous CRASHED smoke runs (a run that fails mid-way
  // never reaches its own cleanup step). Not an assertion — just hygiene.
  const busPort = new URL(process.env.III_URL ?? 'ws://localhost:8112').port || '8112'
  const cleanup = (cleanId: string) => {
    execSync(
      `iii trigger --port ${busPort} stream::delete 'stream_name=renders' 'group_id=all' 'item_id=${cleanId}'`,
      { stdio: 'pipe' },
    )
    for (const side of ['in', 'out']) {
      const p = `./blob/${side}/${cleanId}.png`
      if (existsSync(p)) rmSync(p)
    }
  }
  for (const stale of (rows0 as Array<{ id: string; caption: string }>).filter((r) => /^smoke-\d+$/.test(r.caption))) {
    console.log(`  ~ sweeping stale smoke item ${stale.id} (${stale.caption})`)
    cleanup(stale.id)
  }

  // --- 3. auth NEGATIVE: no token / wrong token → 401 ---
  for (const [label, headers] of [
    ['no token', {}],
    ['wrong token', { Authorization: 'Bearer nope' }],
  ] as const) {
    const r = await fetch(`${BASE}/api/render?caption=x`, { method: 'POST', headers, body: TINY_PNG })
    assert(r.status === 401, `POST /api/render ${label} → 401`, `got ${r.status}`)
  }

  // --- 4. auth POSITIVE + full render path via fake provider (the check that
  //        would have caught the 0.18 middleware change: 401-for-all looks
  //        identical from the negative side) ---
  const render = await fetch(`${BASE}/api/render?provider=fake&caption=${smokeCaption}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}` },
    body: TINY_PNG,
  })
  const polished = Buffer.from(await render.arrayBuffer()) // read once — details below reuse it
  assert(render.status === 200, 'POST /api/render valid token → 200', `got ${render.status}: ${polished.toString('utf8').slice(0, 200)}`)
  const rct = render.headers.get('content-type') ?? ''
  assert(rct.startsWith('image/png'), 'render response content-type image/png', `got "${rct}"`)
  assert(polished.equals(TINY_PNG), 'fake provider echoes sketch bytes exactly', `${polished.length} vs ${TINY_PNG.length} bytes`)

  // --- 5. the render landed in the stream (positive store path) ---
  const rows1 = (await (await fetch(`${BASE}/api/renders`)).json()) as Array<{ id: string; caption: string }>
  const item = rows1.find((r) => r.caption === smokeCaption)
  assert(item, 'render appears in /api/renders', `caption ${smokeCaption} not found in ${rows1.length} rows`)
  const id = item!.id

  // --- 6. stored PNG streams back ---
  const img = await fetch(`${BASE}/api/image?id=${id}&side=out`)
  assert(img.status === 200 && (img.headers.get('content-type') ?? '').startsWith('image/png'),
    '/api/image streams stored PNG', `status ${img.status}, ct ${img.headers.get('content-type')}`)

  // --- 7. browser RBAC listener: valid token connects, missing token refused ---
  // "Accepted" = the connection opens AND the server lets it live. The RBAC
  // listener completes the WS upgrade before running auth::browser, then closes
  // rejected sessions — so onopen alone is NOT acceptance (learned the hard way).
  const wsCheck = (url: string) =>
    new Promise<boolean>((resolve) => {
      const ws = new WebSocket(url)
      let settle: NodeJS.Timeout
      ws.onopen = () => { settle = setTimeout(() => { ws.close(); resolve(true) }, 2000) }
      ws.onclose = () => { clearTimeout(settle); resolve(false) }
      ws.onerror = () => { clearTimeout(settle); resolve(false) }
      setTimeout(() => { if (ws.readyState !== 1) { ws.close(); resolve(false) } }, 4000)
    })
  const host = new URL(BASE).hostname
  assert(await wsCheck(`ws://${host}:${WS_PORT}?token=${encodeURIComponent(BROWSER_TOKEN!)}`),
    `browser WS :${WS_PORT} accepts valid token`, 'connection failed')
  assert(!(await wsCheck(`ws://${host}:${WS_PORT}?token=wrong`)),
    `browser WS :${WS_PORT} refuses bad token`, 'bad token was accepted')

  // --- 8. cleanup (and prove delete propagates out of the list) ---
  cleanup(id)
  const rows2 = (await (await fetch(`${BASE}/api/renders`)).json()) as Array<{ id: string }>
  assert(!rows2.some((r) => r.id === id), 'smoke item cleaned up', `${id} still in list`)

  console.log(`\nSMOKE PASS — ${n} assertions, all executed`)
}

main().catch((e) => fail('unexpected error', String(e?.stack ?? e)))
