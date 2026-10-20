import type { MoodId } from '../types.ts'
import type { FrameSpec } from './compose.ts'
import type { EarKind, EyeKind, TailKind } from './parts.ts'

/** Animation ticks per second. */
export const FPS = 10

/** One-off reactions layered on top of the mood. */
export type Reaction = { kind: 'petted' | 'celebrate'; startTick: number }
const REACTION_TICKS = { petted: 15, celebrate: 30 }

/** One back-and-forth sweep of the tail. */
const WAG: TailKind[] = ['wagMid', 'wagUp', 'wagMid', 'wagLow']
const HOP = [0, -1, -3, -4, -3, -1, 0, 0]
const BIG_HOP = [0, -2, -5, -7, -8, -7, -5, -2, 0, 0]

/** `open` eyes, with a blink (half, closed, half) every `every` ticks. */
function blink(tick: number, open: EyeKind, every = 42): EyeKind {
  const t = tick % every
  if (t === 1) return 'closed'
  return t === 0 || t === 2 ? 'half' : open
}

/** Pricked ears; every `every` ticks one of them swivels sideways for a moment, as if listening. */
function listening(tick: number, every: number): [EarKind, EarKind] {
  if ((tick + 40) % every >= 4) return ['up', 'up']
  return Math.floor(tick / every) % 2 ? ['up', 'side'] : ['side', 'up']
}

/** A heart (or zzz) that floats up from `fromY` and wobbles, `period` ticks per loop. */
function floater(tick: number, period: number, x: number, phase = 0, fromY = 16): { x: number; y: number } {
  const t = (tick + phase) % period
  return { x: x + (Math.floor(t / 4) % 2), y: fromY - Math.floor((t / period) * 12) }
}

function base(bowl: number): FrameSpec {
  return {
    pose: 'sit',
    ears: ['up', 'up'],
    eyes: 'open',
    brows: null,
    eyeShift: 0,
    mouth: 'smile',
    tail: 'rest',
    blush: false,
    dy: 0,
    headDx: 0,
    headDy: 0,
    bowl,
    overlays: []
  }
}

/** The frame to draw for a mood at an animation tick. */
export function frameFor(mood: MoodId, tick: number, bowl: number, reaction?: Reaction | null): FrameSpec {
  const f = base(bowl)

  switch (mood) {
    case 'ecstatic': {
      const hop = tick % HOP.length
      f.eyes = 'happy'
      f.mouth = tick % 4 < 2 ? 'pant' : 'pant2'
      f.blush = true
      f.tail = WAG[tick % WAG.length]
      f.dy = HOP[hop]
      // The head lags a pixel behind on landing.
      f.headDy = hop === 6 ? 1 : 0
      f.overlays.push({ kind: 'heart', ...floater(tick, 20, 48) }, { kind: 'heart', ...floater(tick, 20, 56, 10) })
      break
    }
    case 'happy':
      f.eyes = blink(tick, 'open')
      // Panting: tongue and head bob together.
      f.mouth = Math.floor(tick / 3) % 2 ? 'pant2' : 'pant'
      f.headDy = Math.floor(tick / 3) % 2
      f.blush = true
      f.tail = WAG[Math.floor(tick / 2) % WAG.length]
      break
    case 'content':
      f.ears = listening(tick, 70)
      f.eyes = blink(tick, 'open', 46)
      f.headDy = Math.floor(tick / 15) % 2
      // A lazy thump of the tail now and then.
      f.tail = tick % 40 >= 34 ? (['wagLow', 'rest'] as const)[tick % 2] : 'rest'
      break
    case 'anxious':
      f.ears = ['back', 'back']
      f.brows = 'worried'
      f.eyes = blink(tick, 'open', 30)
      // Keeps glancing at the bowl, and licks its nose now and then.
      f.eyeShift = tick % 50 < 20 ? 1 : 0
      f.mouth = tick % 45 >= 41 ? 'lick' : 'frown'
      f.tail = 'low'
      f.overlays.push({ kind: 'sweat', x: 50, y: 11 + (Math.floor(tick / 5) % 3) })
      break
    case 'sad':
      f.pose = 'lie'
      f.ears = ['back', 'back']
      f.brows = 'worried'
      f.eyes = blink(tick, 'sad', 50)
      f.mouth = 'frown'
      f.tail = 'flat'
      // A heavy sigh now and then.
      f.headDy = tick % 60 >= 52 ? 1 : 0
      if (tick % 40 >= 20) f.overlays.push({ kind: 'tear', x: 25, y: 48 + Math.floor(((tick % 40) - 20) / 5) })
      break
    case 'exhausted':
      f.pose = 'lie'
      f.ears = ['relaxed', 'relaxed']
      f.eyes = 'closed'
      f.mouth = 'sleep'
      f.tail = 'flat'
      f.headDy = Math.floor(tick / 12) % 2
      f.overlays.push(
        { kind: 'zzz', ...floater(tick, 30, 51, 0, 26) },
        { kind: 'zSmall', ...floater(tick, 30, 58, 15, 26) }
      )
      break
    case 'sniffing': {
      // Cocks one ear, then the other, and works its nose.
      const side = Math.floor(tick / 30) % 2
      f.ears = side ? ['side', 'up'] : ['up', 'side']
      f.brows = 'raised'
      f.eyes = blink(tick, 'open')
      f.eyeShift = side ? -1 : 1
      f.headDx = side ? -1 : 1
      f.headDy = tick % 20 < 6 ? Math.floor(tick / 2) % 2 : 0
      f.mouth = 'sniff'
      f.overlays.push({ kind: 'question', x: 51, y: 2 + (Math.floor(tick / 8) % 2) })
      break
    }
  }

  if (reaction) {
    const t = tick - reaction.startTick
    if (reaction.kind === 'petted' && t >= 0 && t < REACTION_TICKS.petted) {
      f.eyes = 'happy'
      f.brows = null
      f.mouth = 'smile'
      f.blush = true
      if (f.pose === 'sit') {
        // Ears go soft under the hand, then the tail gets going.
        f.ears = t < 10 ? ['back', 'back'] : ['up', 'up']
        f.tail = WAG[t % WAG.length]
      }
      const top = f.pose === 'sit' ? 12 : 30
      f.overlays.push({ kind: 'heart', x: 30 + (t % 2), y: top - Math.floor(t / 2) })
    }
    if (reaction.kind === 'celebrate' && t >= 0 && t < REACTION_TICKS.celebrate) {
      f.pose = 'sit'
      f.ears = ['up', 'up']
      f.brows = null
      f.eyes = 'happy'
      f.mouth = 'pant'
      f.blush = true
      f.tail = WAG[t % WAG.length]
      f.dy = BIG_HOP[t % BIG_HOP.length]
      f.headDx = 0
      f.overlays = [
        { kind: 'sparkle', x: 4 + (t % 3), y: 14 + (t % 4) },
        { kind: 'sparkle', x: 51 - (t % 3), y: 1 + ((t + 2) % 4) },
        { kind: 'sparkle', x: 57, y: 30 - (t % 5) }
      ]
    }
  }
  return f
}

export function reactionActive(reaction: Reaction | null | undefined, tick: number): boolean {
  return !!reaction && tick - reaction.startTick < REACTION_TICKS[reaction.kind]
}
