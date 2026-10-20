import { joyOf, moodFor, pickPrimary } from '../shared/mood.ts'
import type { MoodId, PetState, UsageSnapshot } from '../shared/types.ts'

export interface MoodChange {
  from: MoodId | null
  to: MoodId
  state: PetState
}

// Minimum usage drop past the reset time that counts as a reset.
const RESET_DROP = 0.25

export class Aggregator {
  private previewJoy: number | null = null
  private mood: MoodId | null = null
  private previewed = false
  private celebrations = 0
  private seen = new Map<string, { used: number; resetsAt?: number }>()
  private last: PetState = { snapshots: [], primaryId: null, joy: null, mood: 'sniffing', celebrations: 0 }

  constructor(
    private readonly collect: () => UsageSnapshot[],
    private readonly primary: () => string,
    private readonly publish: (state: PetState) => void,
    private readonly onMoodChange: (change: MoodChange) => void
  ) {}

  state(): PetState {
    return this.last
  }

  setPreview(joy: number | null): void {
    this.previewJoy = joy
    this.update()
  }

  // Per source, so a primary switch, preview end or budget edit never counts.
  private sawReset(snapshots: UsageSnapshot[], now: number): boolean {
    let reset = false
    for (const s of snapshots) {
      if (s.usedFraction === null) continue
      const before = this.seen.get(s.id)
      if (before?.resetsAt !== undefined && now >= before.resetsAt && before.used - s.usedFraction >= RESET_DROP) {
        reset = true
      }
      this.seen.set(s.id, { used: s.usedFraction, resetsAt: s.resetsAt })
    }
    return reset
  }

  update(now = Date.now()): void {
    const snapshots = this.collect()
    if (this.sawReset(snapshots, now) && this.previewJoy === null) this.celebrations++
    const primary = this.previewJoy === null ? pickPrimary(snapshots, this.primary(), now) : null
    const joy = this.previewJoy ?? joyOf(primary)
    const mood = moodFor(joy, this.mood)
    const state: PetState = {
      snapshots,
      primaryId: this.previewJoy !== null ? 'debug' : (primary?.id ?? null),
      joy,
      mood,
      resetsAt: primary?.resetsAt,
      celebrations: this.celebrations
    }
    const changed = mood !== this.mood
    const from = this.mood
    // No notifications entering, during or leaving a preview.
    const quiet = this.previewed || this.previewJoy !== null
    this.previewed = this.previewJoy !== null
    this.mood = mood
    this.last = state
    this.publish(state)
    if (changed && !quiet) this.onMoodChange({ from, to: mood, state })
  }
}
