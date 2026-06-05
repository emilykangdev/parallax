// Env is injected by `dotenvx run` (see scripts/dotenvx-wrap.sh) — no dotenv import.
import { registerWorker, Logger } from 'iii-sdk'
import { GoogleGenAI } from '@google/genai'

// Reusable image-polish provider on the iii bus. v0b's daily comic can call the
// same `provider::gemini::render` function via iii.trigger — no duplication.
const iii = registerWorker(process.env.III_URL ?? 'ws://localhost:8112')
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY ?? '' })

interface RenderInput {
  sketchB64: string
  caption: string
  prompt: string
}

iii.registerFunction(
  'provider::gemini::render',
  async (input: RenderInput): Promise<{ polishedB64: string }> => {
    const log = new Logger()

    const resp = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image', // "nano banana"
      contents: [
        { text: input.prompt.replace('{{caption}}', input.caption || '(no caption)') },
        { inlineData: { mimeType: 'image/png', data: input.sketchB64 } },
      ],
      // Image output must be requested explicitly. If the installed model rejects
      // IMAGE-only, switch to ['TEXT', 'IMAGE'] — caught by the Phase 2 smoke test.
      config: { responseModalities: ['IMAGE'] },
    })

    const parts = resp.candidates?.[0]?.content?.parts ?? []
    const img = parts.find((p) => p.inlineData?.data)
    if (!img?.inlineData?.data) {
      throw new Error(`gemini returned no image: ${JSON.stringify(parts)}`)
    }

    log.info('render ok')
    return { polishedB64: img.inlineData.data } // base64 PNG, internal to the bus
  },
  { description: 'Polish a hand-drawn sketch into a comic-style PNG (base64 in/out)' },
)

// Fake provider: same contract, zero cost — echoes the sketch back as the "polish".
// Lets the smoke test (`npm run smoke`) exercise the FULL positive path (HTTP → bus
// → blob → stream → browser) without Gemini quota. render::create routes here only
// when explicitly asked (?provider=fake). Loud log so a fake render is never mistaken
// for a real one.
iii.registerFunction(
  'provider::fake::render',
  async (input: RenderInput): Promise<{ polishedB64: string }> => {
    new Logger().warn('FAKE RENDER — echoing sketch back unpolished (smoke-test path)')
    if (!input.sketchB64) throw new Error('fake provider: sketchB64 required')
    return { polishedB64: input.sketchB64 }
  },
  { description: 'Test-only provider: returns the input sketch unchanged (no API call)' },
)
