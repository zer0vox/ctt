// Renders the dog the way the app does, so a sprite change that breaks a mood fails here
// instead of crashing the app (main process tray icon, pet window, settings face).
import { describe, expect, it } from 'vitest'
import { frameFor, type Reaction } from '../src/shared/sprites/animate.ts'
import { composeScene, SCENE_H, SCENE_W } from '../src/shared/sprites/compose.ts'
import { PALETTE, TRANSPARENT } from '../src/shared/sprites/palette.ts'
import type { MoodId } from '../src/shared/types.ts'

const MOODS: MoodId[] = ['ecstatic', 'happy', 'content', 'anxious', 'sad', 'exhausted', 'sniffing']
const KIBBLE = new Set(['g', 'G'].map((ch) => PALETTE.findIndex((p) => p.ch === ch)))

describe('dog sprites', () => {
  it.each(MOODS)('%s renders at every animation tick, with and without reactions', (mood) => {
    for (let tick = 0; tick < 120; tick++) {
      const reactions: Array<Reaction | null> = [
        null,
        { kind: 'petted', startTick: tick - 3 },
        { kind: 'celebrate', startTick: tick - 5 }
      ]
      for (const reaction of reactions) {
        const scene = composeScene(frameFor(mood, tick, 0.5, reaction))
        expect(scene.length).toBe(SCENE_W * SCENE_H)
        expect(scene.some((px) => px !== TRANSPARENT)).toBe(true)
      }
    }
  })

  it('gives every mood its own look', () => {
    // Tick 5 avoids the blink frames.
    const looks = MOODS.map((m) => composeScene(frameFor(m, 5, 0.5)).join(','))
    expect(new Set(looks).size).toBe(MOODS.length)
  })

  it('fills the bowl with more kibble when more is left', () => {
    const kibble = (bowl: number): number =>
      composeScene(frameFor('content', 5, bowl)).filter((px) => KIBBLE.has(px)).length
    expect(kibble(0)).toBe(0)
    expect(kibble(0.5)).toBeGreaterThan(0)
    expect(kibble(1)).toBeGreaterThan(kibble(0.5))
  })
})
