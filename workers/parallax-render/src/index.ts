// Env is injected by `dotenvx run` (see scripts/dotenvx-wrap.sh) — no dotenv import.
import { registerWorker, Logger, http } from 'iii-sdk'
import type { HttpRequest, HttpResponse } from 'iii-sdk'
import { createReadStream } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'
import { createId } from '@paralleldrive/cuid2'
import { GALLERY_HTML } from './gallery.js'

const iii = registerWorker(process.env.III_URL ?? 'ws://localhost:8112')

// Tuned 2026-06-06 against a real dense whiteboard drawing: the old "preserve every
// labeled component / do not invent" wording made the model return a near-photocopy.
// Transformation requires explicitly licensing it to redraw from scratch and DROP detail.
const RENDER_PROMPT = `
Create a BRAND-NEW comic-strip illustration that tells the story of this whiteboard drawing.
Do NOT reproduce or imitate the original image, its layout, or its handwriting — redraw from
scratch in a completely different style: 4-6 clean panels read left to right, bold ink-and-color
comic art, the system's components as characters, short readable printed labels, speech bubbles
for the key interactions. Choose the 5-8 most important components and the main flow between
them; drop all marginal notes and minor details. If a caption is provided, let it guide which
components matter most.  Caption: {{caption}}
`.trim()

interface RenderRecord {
  id: string
  sourcePath: string
  outputPath: string
  caption: string
  createdAt: string
  tags: string[] | null
  critique: string | null
}

// --- auth::browser: gates the RBAC websocket listener (:3112, see config.yaml) ---
// Browsers can't send WS headers, so the token rides the query string (?token=).
// Read-only browser token, separate from PARALLAX_TOKEN: it's embedded in the
// /scratch HTML, so it must never grant render::create.
iii.registerFunction(
  'auth::browser',
  async (input: { query_params?: Record<string, string[]>; ip_address?: string }) => {
    const token = input.query_params?.token?.[0]
    if (!token || token !== process.env.PARALLAX_BROWSER_TOKEN) {
      throw new Error('unauthorized')
    }
    return {
      allowed_functions: [],
      forbidden_functions: [],
      allow_trigger_type_registration: false,
      allow_function_registration: true, // gallery registers ui::render-changed
      context: { source: 'browser' },
    }
  },
)

// --- bearer auth middleware (0.18 contract: input is { context, phase, request }) ---
// phase is 'preHandler'; the HTTP request rides under .request with lowercased headers.
iii.registerFunction(
  'auth::bearer',
  async (input: { phase?: string; request?: { headers?: Record<string, string> } }) => {
    const header = input.request?.headers?.authorization ?? ''
    const token = String(header).replace(/^Bearer\s+/i, '')
    return token && token === process.env.PARALLAX_TOKEN
      ? { action: 'continue' as const }
      : { action: 'respond' as const, response: { status_code: 401, body: { error: 'unauthorized' } } }
  },
)

// --- render::create: raw PNG in (octet-stream body), raw polished PNG out ---
const renderCreate = iii.registerFunction(
  'render::create',
  http(async (req: HttpRequest, res: HttpResponse) => {
    const log = new Logger()
    const sourceBytes = await req.request_body.readAll()
    const caption = String(req.query_params?.caption ?? '').slice(0, 1000)
    if (!sourceBytes?.length) {
      res.status(400)
      res.stream.end(Buffer.from('{"error":"image required"}'))
      return
    }

    const id = createId()
    const sourcePath = `./blob/in/${id}.png`
    const outputPath = `./blob/out/${id}.png`
    await writeFile(sourcePath, sourceBytes)

    // ?provider=fake routes to the zero-cost echo provider (smoke tests). Harmless
    // to expose behind bearer auth: worst case is your own sketch back, unpolished.
    const provider = req.query_params?.provider === 'fake' ? 'provider::fake::render' : 'provider::gemini::render'
    if (provider !== 'provider::gemini::render') log.warn('using fake provider', { id })
    const { polishedB64 } = await iii.trigger<
      { sketchB64: string; caption: string; prompt: string },
      { polishedB64: string }
    >({
      function_id: provider,
      payload: { sketchB64: sourceBytes.toString('base64'), caption, prompt: RENDER_PROMPT },
    })
    const polishedBytes = Buffer.from(polishedB64, 'base64')
    await writeFile(outputPath, polishedBytes)

    const data: RenderRecord = {
      id,
      sourcePath,
      outputPath,
      caption,
      createdAt: new Date().toISOString(),
      tags: null,
      critique: null,
    }
    // Persist + push to subscribed browsers + fire `stream` triggers — one call.
    await iii.trigger({
      function_id: 'stream::set',
      payload: { stream_name: 'renders', group_id: 'all', item_id: id, data },
    })

    // Sketch row in SQLite — the future judge worker's history (schema owned by
    // parallax-comprehension; see tmp/briefs/2026-06-06-v1-drawing-loop.md). The comic must
    // still come back if this fails (comprehension worker not up yet → table missing), so
    // log loudly and continue — never 500 the drawing loop over its own bookkeeping.
    const repo = String(req.query_params?.repo ?? '') || null
    try {
      await iii.trigger({
        function_id: 'database::execute',
        payload: {
          db: 'primary',
          sql: `INSERT INTO sketches (id, repo_slug, caption, source_path, output_path, created_at)
                VALUES (?, ?, ?, ?, ?, ?)`,
          params: [id, repo, caption, sourcePath, outputPath, data.createdAt],
        },
      })
    } catch (err) {
      log.error('sketch row insert FAILED — judge history is missing this drawing', {
        id,
        error: String(err),
      })
    }

    res.status(200)
    res.headers({ 'content-type': 'image/png' })
    res.stream.end(polishedBytes)
    log.info('render ok', { id })
  }),
)

// --- render::image: stream a stored PNG (gallery <img> tags) ---
const renderImage = iii.registerFunction(
  'render::image',
  http(async (req: HttpRequest, res: HttpResponse) => {
    const id = String(req.query_params?.id ?? '')
    const side = req.query_params?.side === 'in' ? 'in' : 'out'
    res.status(200)
    res.headers({ 'content-type': 'image/png', 'cache-control': 'public, max-age=31536000' })
    await pipeline(createReadStream(`./blob/${side}/${id}.png`), res.stream)
  }),
)

// --- render::list: JSON feed of the most recent renders ---
const renderList = iii.registerFunction('render::list', async () => {
  // 0.18: stream::list returns the items as a bare array (0.16 wrapped it in { group }).
  const result = await iii.trigger<
    { stream_name: string; group_id: string },
    RenderRecord[] | { group: RenderRecord[] }
  >({
    function_id: 'stream::list',
    payload: { stream_name: 'renders', group_id: 'all' },
  })
  const group = Array.isArray(result) ? result : (result?.group ?? [])
  const rows = group
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, 100)
  return { status_code: 200, headers: { 'content-type': 'application/json' }, body: rows }
})

// --- gallery::page: the /scratch HTML shell; data + live updates via iii-browser-sdk ---
// Streaming http() form, not a plain ApiResponse: on engine 0.18 the rest_api worker
// ignores ApiResponse.headers for non-streaming functions and JSON-encodes string
// bodies (browser shows quoted raw HTML). The http() wrapper's status()/headers()
// travel as channel control messages and are honored. Same form as render::image.
const galleryPage = iii.registerFunction(
  'gallery::page',
  http(async (_req: HttpRequest, res: HttpResponse) => {
    // Inject the read-only browser token at serve time (placeholder lives in gallery.ts).
    const page = GALLERY_HTML.replace('__BROWSER_TOKEN__', process.env.PARALLAX_BROWSER_TOKEN ?? '')
    res.status(200)
    res.headers({ 'content-type': 'text/html; charset=utf-8' })
    res.stream.end(Buffer.from(page))
  }),
)

// --- triggers: bind functions to HTTP routes; protect render::create with bearer middleware ---
iii.registerTrigger({
  type: 'http',
  function_id: renderCreate.id,
  config: { api_path: '/api/render', http_method: 'POST', middleware_function_ids: ['auth::bearer'] },
})
iii.registerTrigger({
  type: 'http',
  function_id: renderImage.id,
  config: { api_path: '/api/image', http_method: 'GET' },
})
iii.registerTrigger({
  type: 'http',
  function_id: renderList.id,
  config: { api_path: '/api/renders', http_method: 'GET' },
})
iii.registerTrigger({
  type: 'http',
  function_id: galleryPage.id,
  config: { api_path: '/scratch', http_method: 'GET' },
})
