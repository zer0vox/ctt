// Merges provider snapshots into the pet state and tracks mood changes for notifications.

import { joyOf, moodFor, pickPrimary } from '../shared/mood.ts'
import type { MoodId, PetState, UsageSnapshot } from '../shared/types.ts'

export interface MoodChange {
  from: MoodId | null
  to: MoodId
  state: PetState
}

/** How much a limit's usage must drop, after its reset time, to count as a reset worth celebrating. */
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

  /**
   * True when a limit really reset: the reset time we knew about has passed and its usage fell.
   * Compared per source, so switching which source drives the mood, ending a preview or editing
   * a budget (same reset time) never counts.
   */
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
    // Moving into, during or out of a preview never sends notifications.
    const quiet = this.previewed || this.previewJoy !== null
    this.previewed = this.previewJoy !== null
    this.mood = mood
    this.last = state
    this.publish(state)
    if (changed && !quiet) this.onMoodChange({ from, to: mood, state })
  }
}
