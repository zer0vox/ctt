import { describe, expect, it } from 'vitest'
import { Aggregator } from '../src/main/aggregator.ts'
import type { PetState, UsageSnapshot } from '../src/shared/types.ts'

const HOUR = 3_600_000
const snap = (id: string, usedFraction: number, resetsAt?: number): UsageSnapshot => ({
  id,
  short: id,
  label: id,
  usedFraction,
  resetsAt,
  stale: false,
  updatedAt: 0,
  summary: '',
  details: []
})

function setup(primary = 'auto') {
  let snaps: UsageSnapshot[] = []
  let choice = primary
  let last: PetState | null = null
  const agg = new Aggregator(
    () => snaps,
    () => choice,
    (s) => (last = s),
    () => {}
  )
  return {
    agg,
    set: (s: UsageSnapshot[]) => (snaps = s),
    choose: (p: string) => (choice = p),
    celebrations: () => last!.celebrations
  }
}

describe('Aggregator celebrations', () => {
  const t0 = Date.UTC(2026, 9, 20, 12)

  it('celebrates when a known reset time passes and usage drops', () => {
    const a = setup()
    a.set([snap('plan-5h', 0.95, t0 + HOUR)])
    a.agg.update(t0)
    a.set([snap('plan-5h', 0)])
    a.agg.update(t0 + HOUR + 1000)
    expect(a.celebrations()).toBe(1)
  })

  it('does not celebrate when the primary source switches', () => {
    const a = setup('plan-7d')
    a.set([snap('plan-5h', 0.05, t0 + HOUR), snap('plan-7d', 0.9, t0 + 50 * HOUR)])
    a.agg.update(t0)
    a.choose('plan-5h') // 10% left becomes 95% left, but nothing reset
    a.agg.update(t0 + 1000)
    expect(a.celebrations()).toBe(0)
  })

  it('does not celebrate when a budget is raised before its period ends', () => {
    const a = setup()
    a.set([snap('logs', 0.9, t0 + 6 * HOUR)])
    a.agg.update(t0)
    a.set([snap('logs', 0.2, t0 + 6 * HOUR)])
    a.agg.update(t0 + 1000)
    expect(a.celebrations()).toBe(0)
  })

  it('does not celebrate when a preview ends', () => {
    const a = setup()
    a.set([snap('plan-5h', 0.9, t0 + HOUR)])
    a.agg.update(t0)
    a.agg.setPreview(0.1)
    a.agg.setPreview(null)
    expect(a.celebrations()).toBe(0)
  })

  it('needs a real drop, not a small wobble after the reset time', () => {
    const a = setup()
    a.set([snap('api', 0.3, t0 + HOUR)])
    a.agg.update(t0)
    a.set([snap('api', 0.2, t0 + 30 * 24 * HOUR)])
    a.agg.update(t0 + 2 * HOUR)
    expect(a.celebrations()).toBe(0)
  })
})
