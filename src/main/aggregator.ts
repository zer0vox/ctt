// Merges provider snapshots into the pet state and tracks mood changes for notifications.

import { joyOf, moodFor, pickPrimary } from '../shared/mood.ts'
import type { MoodId, PetState, UsageSnapshot } from '../shared/types.ts'

export interface MoodChange {
  from: MoodId | null
  to: MoodId
  state: PetState
}

export class Aggregator {
  private previewJoy: number | null = null
  private mood: MoodId | null = null
  private previewed = false
  private last: PetState = { snapshots: [], primaryId: null, joy: null, mood: 'sniffing' }

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

  update(): void {
    const snapshots = this.collect()
    const primary = this.previewJoy === null ? pickPrimary(snapshots, this.primary()) : null
    const joy = this.previewJoy ?? joyOf(primary)
    const mood = moodFor(joy, this.mood)
    const state: PetState = {
      snapshots,
      primaryId: this.previewJoy !== null ? 'debug' : (primary?.id ?? null),
      joy,
      mood,
      resetsAt: primary?.resetsAt
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
