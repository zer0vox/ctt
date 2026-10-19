import { fmtPct } from './format.ts'
import { MOOD_LABELS } from './mood.ts'
import type { PetState } from './types.ts'

/** One line describing the pup's mood and what drives it, e.g. "Happy · 5-hour limit 63% left". */
export function headline(state: PetState): string {
  const primary = state.snapshots.find((s) => s.id === state.primaryId)
  const mood = MOOD_LABELS[state.mood]
  if (state.primaryId === 'debug' && state.joy !== null) return `${mood} · preview ${fmtPct(state.joy)} left`
  if (!primary || state.joy === null) return `${mood} · no usage data yet`
  return `${mood} · ${primary.label} ${fmtPct(state.joy)} left`
}
