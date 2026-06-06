// The /scratch gallery page. Served as a string by gallery::page.
// Loads data via render::list, then stays live by registering a browser function
// bound to a `stream` trigger on the `renders` stream — registerTrigger IS the
// subscribe; there is no separate subscribe() method. The browser connects to the
// RBAC listener on :3112 (see config.yaml), token via ?token= because browsers
// can't send custom WS headers. __BROWSER_TOKEN__ is injected by gallery::page.
export const GALLERY_HTML = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Parallax Scratch</title>
    <style>
      body { font-family: ui-sans-serif, system-ui; margin: 2rem; }
      #grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(420px, 1fr)); gap: 1rem; }
      .cell { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; }
      .cell img { width: 100%; aspect-ratio: 1; object-fit: contain; background: #fafafa; border: 1px solid #eee; }
      .cap { grid-column: 1 / -1; font-style: italic; color: #444; }
      .meta { grid-column: 1 / -1; font-size: 0.8rem; color: #888; }
    </style>
  </head>
  <body>
    <div id="grid"></div>
    <script>
      // crypto.randomUUID only exists in secure contexts (https / localhost). Over the
      // tailnet the page is plain http on a non-localhost host, so the iii SDK dies
      // generating message IDs. crypto.getRandomValues IS available in insecure
      // contexts — polyfill before the module script imports the SDK (verified 2026-06-06).
      if (!crypto.randomUUID) {
        crypto.randomUUID = () =>
          '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) =>
            (+c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (+c / 4)))).toString(16))
      }
    </script>
    <script type="module">
      import { registerWorker } from 'https://esm.sh/iii-browser-sdk@0.18.0'
      const iii = registerWorker('ws://' + location.hostname + ':3112?token=' + encodeURIComponent('__BROWSER_TOKEN__'))

      const grid = document.getElementById('grid')
      const byId = new Map()
      const cell = (r) => \`<div class="cell">
        <img src="/api/image?id=\${r.id}&side=in" alt="sketch">
        <img src="/api/image?id=\${r.id}&side=out" alt="polished">
        <div class="cap">\${r.caption ?? ''}</div>
        <div class="meta">\${new Date(r.createdAt).toLocaleString()} \${(r.tags ?? []).join(' · ')}</div>
      </div>\`
      const repaint = () => {
        grid.innerHTML = [...byId.values()]
          .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
          .map(cell)
          .join('')
      }

      // initial load
      const rows = await iii.trigger({ function_id: 'render::list', payload: {} })
      ;(rows.body ?? rows).forEach((r) => byId.set(r.id, r))
      repaint()

      // live updates: register a browser function the engine invokes on every change
      // to the renders stream (new render + companion caption/tag/critique writes).
      const onChange = iii.registerFunction('ui::render-changed', async (evt) => {
        const d = evt?.event?.data
        if (evt?.event?.type === 'delete') {
          // on delete, event.data is the removed value — drop it, don't re-set it
          byId.delete(d?.id ?? evt.id)
          repaint()
        } else if (d) {
          byId.set(d.id, d)
          repaint()
        }
        return null
      })
      iii.registerTrigger({
        type: 'stream',
        function_id: onChange.id,
        config: { stream_name: 'renders', group_id: 'all' },
      })
    </script>
  </body>
</html>`
