// parallax push — walk a repo's mermaids/ folder and POST it to /api/diagrams as an authoritative
// snapshot. Env injected by dotenvx-wrap (PARALLAX_TOKEN, PARALLAX_BASE_URL).
//
// Usage:  npm run push -- --repo <slug> --dir <path-to-mermaids>
// NOTE: dotenvx-wrap cd's to the parallax repo root, so a relative --dir resolves from there.
// To push an EXTERNAL repo, pass an ABSOLUTE --dir.
import { readFileSync, statSync, readdirSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { basename, join, resolve } from 'node:path'

const arg = (k: string, d?: string): string | undefined => {
  const i = process.argv.indexOf(`--${k}`)
  return i >= 0 ? process.argv[i + 1] : d
}

const base = process.env.PARALLAX_BASE_URL ?? 'http://localhost:3111'
const token = process.env.PARALLAX_TOKEN
if (!token) throw new Error('PARALLAX_TOKEN required — push does not skip') // FAIL HARD

const dir = resolve(arg('dir', './mermaids')!) // cwd is parallax root (dotenvx-wrap cd's there)
const repo = arg('repo', basename(resolve(dir, '..')))! // default: the folder containing mermaids/
if (!existsSync(dir)) throw new Error(`no mermaids/ folder at ${dir} — Parallax needs mermaids/*.mermaid`)
const files = readdirSync(dir).filter((f) => f.endsWith('.mermaid'))
if (files.length === 0) throw new Error(`no .mermaid files in ${dir}`) // FAIL HARD

const diagrams = files.map((f) => {
  const p = join(dir, f)
  const mermaidText = readFileSync(p, 'utf8')
  return {
    concept: basename(f, '.mermaid'),
    filePath: `mermaids/${f}`,
    mermaidText,
    sha256: createHash('sha256').update(mermaidText).digest('hex'), // server re-hashes; advisory only
    mermaidMtime: statSync(p).mtime.toISOString(),
  }
})

const indexPath = join(dir, 'INDEX.md')
const index = existsSync(indexPath) ? readFileSync(indexPath, 'utf8') : null
if (index == null) console.warn(`warn: no INDEX.md in ${dir} — pushing without index`)

const res = await fetch(`${base}/api/diagrams`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  body: JSON.stringify({ repo, index, diagrams }),
})
if (!res.ok) throw new Error(`push failed ${res.status}: ${await res.text()}`) // FAIL HARD
const s = (await res.json()) as { repo: string; new: number; changed: number; unchanged: number; removed: number }
console.log(`pushed ${s.repo}: ${s.new} new, ${s.changed} changed, ${s.unchanged} unchanged, ${s.removed} removed`)
