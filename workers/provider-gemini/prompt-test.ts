// Throwaway prompt-iteration harness: run RENDER_PROMPT variants against a real
// drawing from blob/in, save outputs to /tmp for side-by-side comparison.
// Run from repo root: bash scripts/dotenvx-wrap.sh npx tsx workers/provider-gemini/prompt-test.ts
import { GoogleGenAI } from '@google/genai'
import { readFile, writeFile } from 'node:fs/promises'

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY ?? '' })
const sketchB64 = (await readFile('./blob/in/gsmzkdvbmjdqlf73yl15j70e.png')).toString('base64')

const VARIANTS: Record<string, string> = {
  comic: `
Create a BRAND-NEW comic-strip illustration that tells the story of this whiteboard diagram.
Do NOT reproduce or imitate the original image, its layout, or its handwriting — redraw from
scratch in a completely different style: 4-6 clean panels read left to right, bold ink-and-color
comic art, the system's components as characters, short readable printed labels, speech bubbles
for the key interactions. Choose the 5-8 most important components and the main flow between
them; drop all marginal notes and minor details.
`.trim(),
  poster: `
Redraw this messy whiteboard as ONE clean, beautifully organized architecture poster.
Completely new artwork — do not copy the original layout or handwriting. Clear titled boxes,
orthogonal arrows, consistent color coding by subsystem, readable printed typography, generous
whitespace. Keep the main components and the primary data flows; omit marginal scribbles and
side notes.
`.trim(),
}

for (const [name, prompt] of Object.entries(VARIANTS)) {
  console.log(`rendering variant: ${name} …`)
  const resp = await ai.models.generateContent({
    model: 'gemini-2.5-flash-image',
    contents: [{ text: prompt }, { inlineData: { mimeType: 'image/png', data: sketchB64 } }],
    config: { responseModalities: ['IMAGE'] },
  })
  const img = resp.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)
  if (!img?.inlineData?.data) throw new Error(`${name}: no image returned`)
  await writeFile(`/tmp/variant-${name}.png`, Buffer.from(img.inlineData.data, 'base64'))
  console.log(`wrote /tmp/variant-${name}.png`)
}
