// Env is injected by `dotenvx run` (see scripts/dotenvx-wrap.sh) — no dotenv import.
// v0b-1: SQLite source of truth + diagrams::upsert. A push is an AUTHORITATIVE snapshot of a
// repo's mermaids/ folder, applied as ONE atomic database::transaction.
import { registerWorker, Logger, http } from 'iii-sdk'
import type { HttpRequest, HttpResponse } from 'iii-sdk'
import { createId } from '@paralleldrive/cuid2'
import { createHash } from 'node:crypto'
import { makeDb, type Stmt } from './db.js'

const iii = registerWorker(process.env.III_URL ?? 'ws://localhost:8112')
const db = makeDb(iii)
const hash = (text: string) => createHash('sha256').update(text).digest('hex')

// repos.slug IS the primary key (no cuid repo id) → the whole snapshot runs as one conflict-safe
// transaction with no read-back-the-id step. diagrams keep a cuid `id` for v0b-2's FKs.
async function ensureSchema() {
  await db.exec(`CREATE TABLE IF NOT EXISTS repos (
    slug           TEXT PRIMARY KEY,
    last_pushed_at TEXT NOT NULL
  )`)
  await db.exec(`CREATE TABLE IF NOT EXISTS diagrams (
    id            TEXT PRIMARY KEY,
    repo_slug     TEXT NOT NULL,
    concept       TEXT NOT NULL,
    file_path     TEXT NOT NULL,
    mermaid_text  TEXT NOT NULL,
    sha256        TEXT NOT NULL,
    mermaid_mtime TEXT NOT NULL,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL,
    UNIQUE(repo_slug, concept)
  )`)
  await db.exec(`CREATE TABLE IF NOT EXISTS diagram_index (
    repo_slug  TEXT PRIMARY KEY,
    raw_text   TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`)
  // Judge-ready drawing history (see tmp/briefs/2026-06-06-v1-drawing-loop.md). One row per
  // render::create; id matches the blob filenames + stream item. repo_slug is nullable —
  // repo targeting is deliberately deferred.
  await db.exec(`CREATE TABLE IF NOT EXISTS sketches (
    id          TEXT PRIMARY KEY,
    repo_slug   TEXT,
    caption     TEXT NOT NULL,
    source_path TEXT NOT NULL,
    output_path TEXT NOT NULL,
    created_at  TEXT NOT NULL
  )`)
}

// Create the schema BEFORE registering the function/trigger, so the route can never go live on the
// bus while the tables are missing (cold-start race). The trigger isn't published until below.
// Retry: when the engine supervises both this worker and the `database` binary (via iii-exec),
// the database worker may register a moment after us — tolerate that instead of crashing on boot.
async function ensureSchemaWithRetry(attempts = 30, delayMs = 1000) {
  for (let attempt = 1; ; attempt++) {
    try {
      await ensureSchema()
      return
    } catch (err) {
      if (attempt >= attempts) throw err
      new Logger().warn('schema not ready (database worker still booting?) — retrying', {
        attempt,
        attempts,
        error: String(err),
      })
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }
}
await ensureSchemaWithRetry()

// diagrams::upsert — JSON in, JSON out, via the http() streaming form (0.18: plain functions
// JSON-encode string bodies + drop headers; the streaming form is the gotcha-free path).
const diagramsUpsert = iii.registerFunction(
  'diagrams::upsert',
  http(async (req: HttpRequest, res: HttpResponse) => {
    const log = new Logger()
    const reply = (code: number, obj: unknown) => {
      res.status(code)
      res.headers({ 'content-type': 'application/json' })
      res.stream.end(Buffer.from(JSON.stringify(obj)))
    }

    let body: { repo?: unknown; index?: unknown; diagrams?: unknown }
    try {
      body = JSON.parse((await req.request_body.readAll()).toString('utf8'))
    } catch {
      return reply(400, { error: 'invalid JSON' })
    }

    // 1. Validate the WHOLE payload up front — 400 before touching the DB. One malformed entry
    //    must never produce a partial import.
    const str = (v: unknown): v is string => typeof v === 'string' && v.length > 0
    if (!str(body.repo)) return reply(400, { error: 'repo must be a non-empty string' })
    if (!Array.isArray(body.diagrams) || body.diagrams.length === 0)
      return reply(400, { error: 'diagrams[] must be a non-empty array' })
    if (body.index != null && typeof body.index !== 'string')
      return reply(400, { error: 'index must be a string or null' })

    type In = { concept: string; filePath: string; mermaidText: string; mermaidMtime: string }
    const seen = new Set<string>()
    for (const d of body.diagrams as Array<Partial<In>>) {
      if (!str(d?.concept) || !str(d?.filePath) || typeof d?.mermaidText !== 'string' || !str(d?.mermaidMtime))
        return reply(400, { error: 'each diagram needs concept, filePath, mermaidText, mermaidMtime' })
      if (seen.has(d.concept)) return reply(400, { error: `duplicate concept: ${d.concept}` })
      seen.add(d.concept)
    }

    const slug = body.repo
    const index = body.index as string | null
    const items = body.diagrams as In[]
    const now = new Date().toISOString()

    // 2. Pre-read current state for the count report only (server RE-HASHES — client sha256 ignored).
    const rows = await db.query<{ concept: string; sha256: string }>(
      `SELECT concept, sha256 FROM diagrams WHERE repo_slug = ?`,
      [slug],
    )
    const stored = new Map(rows.map((r) => [r.concept, r.sha256]))
    const shas = new Map(items.map((d) => [d.concept, hash(d.mermaidText)]))
    let added = 0
    let changed = 0
    let unchanged = 0
    for (const d of items) {
      const prev = stored.get(d.concept)
      if (prev === undefined) added++
      else if (prev !== shas.get(d.concept)) changed++
      else unchanged++
    }
    const removed = [...stored.keys()].filter((c) => !seen.has(c)).length

    // 3. Apply as ONE atomic snapshot: repo upsert → conflict-safe diagram upserts → authoritative
    //    delete of absent concepts → index. last_pushed_at only advances if the batch commits.
    const stmts: Stmt[] = []
    stmts.push({
      sql: `INSERT INTO repos (slug, last_pushed_at) VALUES (?, ?)
            ON CONFLICT(slug) DO UPDATE SET last_pushed_at = excluded.last_pushed_at`,
      params: [slug, now],
    })
    for (const d of items) {
      stmts.push({
        sql: `INSERT INTO diagrams (id, repo_slug, concept, file_path, mermaid_text, sha256, mermaid_mtime, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(repo_slug, concept) DO UPDATE SET
                file_path = excluded.file_path,
                mermaid_text = excluded.mermaid_text,
                sha256 = excluded.sha256,
                mermaid_mtime = excluded.mermaid_mtime,
                updated_at = excluded.updated_at
              WHERE diagrams.sha256 <> excluded.sha256`,
        params: [createId(), slug, d.concept, d.filePath, d.mermaidText, shas.get(d.concept), d.mermaidMtime, now, now],
      })
    }
    const ph = items.map(() => '?').join(',')
    stmts.push({
      sql: `DELETE FROM diagrams WHERE repo_slug = ? AND concept NOT IN (${ph})`,
      params: [slug, ...items.map((d) => d.concept)],
    })
    if (index != null) {
      stmts.push({
        sql: `INSERT INTO diagram_index (repo_slug, raw_text, updated_at) VALUES (?, ?, ?)
              ON CONFLICT(repo_slug) DO UPDATE SET raw_text = excluded.raw_text, updated_at = excluded.updated_at`,
        params: [slug, index, now],
      })
    }
    await db.tx(stmts) // throws → http() surfaces 500, nothing committed (last_pushed_at unchanged)

    log.info('diagrams upsert', { repo: slug, added, changed, unchanged, removed })
    reply(200, { repo: slug, new: added, changed, unchanged, removed })
  }),
)

// schema is already ensured above; just publish the route now.
// auth::bearer is registered by parallax-render and resolved cross-worker on the bus — that worker
// must be running for /api/diagrams to authorize (see plan: startup-order gotcha).
iii.registerTrigger({
  type: 'http',
  function_id: diagramsUpsert.id,
  config: { api_path: '/api/diagrams', http_method: 'POST', middleware_function_ids: ['auth::bearer'] },
})
