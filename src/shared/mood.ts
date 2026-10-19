import type { MoodId, UsageSnapshot } from './types.ts'

/** Mood tiers by remaining fraction, highest first. */
export const MOOD_TIERS: ReadonlyArray<{ mood: MoodId; min: number }> = [
  { mood: 'ecstatic', min: 0.8 },
  { mood: 'happy', min: 0.6 },
  { mood: 'content', min: 0.4 },
  { mood: 'anxious', min: 0.2 },
  { mood: 'sad', min: 0.05 },
  { mood: 'exhausted', min: 0 }
]

export const MOOD_LABELS: Record<MoodId, string> = {
  ecstatic: 'Ecstatic',
  happy: 'Happy',
  content: 'Content',
  anxious: 'Anxious',
  sad: 'Sad',
  exhausted: 'Exhausted',
  sniffing: 'Sniffing around'
}

const HYSTERESIS = 0.03

function tierBounds(mood: MoodId): [number, number] | null {
  const i = MOOD_TIERS.findIndex((t) => t.mood === mood)
  if (i < 0) return null
  return [MOOD_TIERS[i].min, i === 0 ? Infinity : MOOD_TIERS[i - 1].min]
}

/**
 * Mood for a remaining fraction. Passing the previous mood adds hysteresis, so a reading
 * that hovers on a tier boundary doesn't make the dog flicker between two moods.
 */
export function moodFor(joy: number | null, prev?: MoodId | null): MoodId {
  if (joy === null || Number.isNaN(joy)) return 'sniffing'
  const j = Math.min(1, Math.max(0, joy))
  if (prev) {
    const b = tierBounds(prev)
    if (b && j >= b[0] - HYSTERESIS && j < b[1] + HYSTERESIS) return prev
  }
  return MOOD_TIERS.find((t) => j >= t.min)?.mood ?? 'exhausted'
}

/**
 * The snapshot that drives the mood: the chosen one if it has data, otherwise the one
 * with the least remaining. Info-only snapshots (no limit) never drive the mood.
 */
export function pickPrimary(snapshots: UsageSnapshot[], primary: string): UsageSnapshot | null {
  const limited = snapshots.filter((s) => s.usedFraction !== null)
  if (primary !== 'auto') {
    const chosen = limited.find((s) => s.id === primary)
    if (chosen) return chosen
  }
  let worst: UsageSnapshot | null = null
  for (const s of limited) if (!worst || s.usedFraction! > worst.usedFraction!) worst = s
  return worst
}

export function joyOf(snapshot: UsageSnapshot | null): number | null {
  if (!snapshot || snapshot.usedFraction === null) return null
  return 1 - Math.min(1, Math.max(0, snapshot.usedFraction))
}
