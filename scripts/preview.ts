// Renders every mood (a few frames each) to scripts/preview-out/moods.png, and the app icon
// to build/icon.png. Run with: npm run sprites
import { mkdirSync, writeFileSync } from 'node:fs'
import { encodePng } from './png.ts'
import { frameFor } from '../src/shared/sprites/animate.ts'
import { composeScene, PORTRAITS, sceneToBitmap, SCENE_H, SCENE_W } from '../src/shared/sprites/compose.ts'
import { PALETTE_RGB } from '../src/shared/sprites/palette.ts'
import type { MoodId } from '../src/shared/types.ts'

const MOODS: MoodId[] = ['ecstatic', 'happy', 'content', 'anxious', 'sad', 'exhausted', 'sniffing']
const TICKS = [3, 10, 25, 45]
const SCALE = 3
const PAD = 4
const BG: [number, number, number] = [236, 240, 245]

const cellW = SCENE_W * SCALE + PAD * 2
const cellH = SCENE_H * SCALE + PAD * 2
const width = cellW * TICKS.length
const height = cellH * MOODS.length
const sheet = new Uint8Array(width * height * 4)
for (let i = 0; i < width * height; i++) sheet.set([...BG, 255], i * 4)

MOODS.forEach((mood, row) => {
  const bowl = { ecstatic: 0.9, happy: 0.7, content: 0.5, anxious: 0.3, sad: 0.1, exhausted: 0, sniffing: 0.5 }[mood]
  TICKS.forEach((tick, col) => {
    const bmp = sceneToBitmap(composeScene(frameFor(mood, tick, bowl)), PALETTE_RGB, SCALE)
    for (let y = 0; y < bmp.height; y++) {
      for (let x = 0; x < bmp.width; x++) {
        const s = (y * bmp.width + x) * 4
        if (!bmp.data[s + 3]) continue
        const d = ((row * cellH + PAD + y) * width + col * cellW + PAD + x) * 4
        sheet.set(bmp.data.subarray(s, s + 4), d)
      }
    }
  })
})

mkdirSync('scripts/preview-out', { recursive: true })
writeFileSync('scripts/preview-out/moods.png', encodePng(sheet, width, height))

// App icon: the happy dog's head and shoulders, 256x256.
const icon = sceneToBitmap(composeScene(frameFor('happy', 5, 1)), PALETTE_RGB, 8, PORTRAITS.sit)
mkdirSync('build', { recursive: true })
writeFileSync('build/icon.png', encodePng(icon.data, icon.width, icon.height))
console.log(`wrote scripts/preview-out/moods.png (${width}x${height}) and build/icon.png`)
