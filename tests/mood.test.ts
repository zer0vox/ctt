import { describe, expect, it } from 'vitest'
import { joyOf, moodFor, pickPrimary } from '../src/shared/mood.ts'
import type { UsageSnapshot } from '../src/shared/types.ts'

const snap = (id: string, usedFraction: number | null): UsageSnapshot => ({
  id,
  short: id,
  label: id,
  usedFraction,
  stale: false,
  updatedAt: 0,
  summary: '',
  details: []
})

describe('moodFor', () => {
  it.each([
    [1, 'ecstatic'],
    [0.8, 'ecstatic'],
    [0.79, 'happy'],
    [0.6, 'happy'],
    [0.5, 'content'],
    [0.3, 'anxious'],
    [0.1, 'sad'],
    [0.04, 'exhausted'],
    [0, 'exhausted']
  ] as const)('maps %s remaining to %s', (joy, mood) => {
    expect(moodFor(joy)).toBe(mood)
  })

  it('sniffs when there is no data', () => {
    expect(moodFor(null)).toBe('sniffing')
  })

  it('holds the previous mood within 3% of a boundary', () => {
    expect(moodFor(0.59, 'happy')).toBe('happy')
    expect(moodFor(0.575, 'happy')).toBe('happy')
    expect(moodFor(0.56, 'happy')).toBe('content')
    expect(moodFor(0.61, 'content')).toBe('content')
    expect(moodFor(0.64, 'content')).toBe('happy')
  })

  it('does not flicker when a reading wobbles around a boundary', () => {
    let mood = moodFor(0.62)
    for (const joy of [0.6, 0.59, 0.61, 0.6, 0.595, 0.605]) {
      mood = moodFor(joy, mood)
      expect(mood).toBe('happy')
    }
  })

  it('clamps out-of-range readings', () => {
    expect(moodFor(1.4)).toBe('ecstatic')
    expect(moodFor(-0.2)).toBe('exhausted')
  })
})

describe('pickPrimary', () => {
  const snaps = [snap('plan-5h', 0.2), snap('plan-7d', 0.7), snap('logs', null)]

  it('auto picks the snapshot with the least remaining', () => {
    expect(pickPrimary(snaps, 'auto')?.id).toBe('plan-7d')
  })

  it('uses the chosen snapshot when it has data', () => {
    expect(pickPrimary(snaps, 'plan-5h')?.id).toBe('plan-5h')
  })

  it('falls back to auto when the chosen one is info-only or missing', () => {
    expect(pickPrimary(snaps, 'logs')?.id).toBe('plan-7d')
    expect(pickPrimary(snaps, 'api')?.id).toBe('plan-7d')
  })

  it('returns null when nothing has a limit', () => {
    expect(pickPrimary([snap('logs', null)], 'auto')).toBeNull()
    expect(joyOf(null)).toBeNull()
  })

  it('turns used into remaining', () => {
    expect(joyOf(snap('x', 0.25))).toBeCloseTo(0.75)
  })
})

describe('pickPrimary with stale readings', () => {
  const now = Date.UTC(2026, 9, 20, 12)
  const stale = (id: string, used: number, resetsAt?: number): UsageSnapshot => ({
    ...snap(id, used),
    stale: true,
    resetsAt
  })

  it('skips a stale reading that may have reset since', () => {
    const picked = pickPrimary([stale('plan-5h', 0.9), snap('logs', 0.3)], 'auto', now)
    expect(picked?.id).toBe('logs')
  })

  it('keeps a stale reading whose reset is still ahead (usage only climbs until then)', () => {
    const picked = pickPrimary([stale('plan-7d', 0.83, now + 86_400_000), snap('plan-5h', 0.1)], 'auto', now)
    expect(picked?.id).toBe('plan-7d')
  })

  it('falls back to stale readings when nothing else has data', () => {
    expect(pickPrimary([stale('plan-5h', 0.9)], 'auto', now)?.id).toBe('plan-5h')
  })

  it('always honours an explicit choice', () => {
    expect(pickPrimary([stale('plan-5h', 0.9), snap('logs', 0.3)], 'plan-5h', now)?.id).toBe('plan-5h')
  })
})
