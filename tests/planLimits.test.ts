import { describe, expect, it } from 'vitest'
import {
  newestPlanState,
  parseBridgeState,
  parseUsageCache,
  planSnapshots,
  STALE_AFTER_MS,
  type PlanState
} from '../src/main/providers/planLimits.ts'

const now = Date.UTC(2026, 9, 17, 12, 0)
const state = (over: Partial<PlanState> = {}): PlanState => ({
  updatedAt: now - 60_000,
  rateLimitsSeenAt: now - 60_000,
  five_hour: { used_percentage: 42, resets_at: Math.floor((now + 3_600_000) / 1000) },
  seven_day: { used_percentage: 18, resets_at: Math.floor((now + 5 * 86_400_000) / 1000) },
  session_cost_usd: 1.2,
  context_used_percentage: 30,
  model: 'Opus',
  ...over
})

describe('planSnapshots', () => {
  it('reports both windows', () => {
    const [five, seven] = planSnapshots(state(), now)
    expect(five.id).toBe('plan-5h')
    expect(five.usedFraction).toBeCloseTo(0.42)
    expect(five.resetsAt).toBe(now + 3_600_000)
    expect(five.stale).toBe(false)
    expect(seven.usedFraction).toBeCloseTo(0.18)
  })

  it('treats a window whose reset time has passed as fresh', () => {
    const [five] = planSnapshots(
      state({ five_hour: { used_percentage: 100, resets_at: Math.floor((now - 1000) / 1000) } }),
      now
    )
    expect(five.usedFraction).toBe(0)
    expect(five.summary).toBe('fresh')
  })

  it('marks old readings stale but keeps their value', () => {
    const [five] = planSnapshots(state({ rateLimitsSeenAt: now - STALE_AFTER_MS - 1 }), now)
    expect(five.stale).toBe(true)
    expect(five.usedFraction).toBeCloseTo(0.42)
  })

  it('skips missing windows and missing state', () => {
    expect(planSnapshots(state({ seven_day: null }), now).map((s) => s.id)).toEqual(['plan-5h'])
    expect(planSnapshots(null, now)).toEqual([])
  })
})

describe("Claude Code's usage cache", () => {
  const config = {
    numStartups: 12,
    oauthAccount: { emailAddress: 'someone@example.com' },
    cachedUsageUtilization: {
      fetchedAtMs: now - 3_600_000,
      accountUuid: 'uuid',
      utilization: {
        five_hour: { utilization: 0, resets_at: null },
        seven_day: { utilization: 74, resets_at: '2026-10-19T23:00:00.415933+00:00' },
        limits: []
      }
    }
  }

  it('reads the 5-hour and weekly windows and nothing else', () => {
    const s = parseUsageCache(config)!
    expect(s.source).toBe('cache')
    expect(s.five_hour).toEqual({ used_percentage: 0, resets_at: null })
    expect(s.seven_day).toEqual({
      used_percentage: 74,
      resets_at: Math.floor(Date.parse('2026-10-19T23:00:00.415Z') / 1000)
    })
    expect(JSON.stringify(s)).not.toContain('someone')
    expect(JSON.stringify(s)).not.toContain('uuid')
  })

  it('becomes snapshots that say where they came from', () => {
    const [five, seven] = planSnapshots(parseUsageCache(config), now)
    expect(five.usedFraction).toBe(0)
    expect(seven.usedFraction).toBeCloseTo(0.74)
    expect(seven.stale).toBe(true)
    expect(seven.details.join(' ')).toContain('/usage')
  })

  it('ignores configs without a usable cache', () => {
    expect(parseUsageCache({})).toBeNull()
    expect(parseUsageCache(null)).toBeNull()
    expect(
      parseUsageCache({ cachedUsageUtilization: { fetchedAtMs: 1, utilization: { five_hour: { utilization: 'x' } } } })
    ).toBeNull()
  })

  it('prefers whichever source saw the limits most recently', () => {
    const bridge = state({ rateLimitsSeenAt: now - 60_000, source: 'bridge' })
    const cache = parseUsageCache(config)!
    expect(newestPlanState(bridge, cache)?.source).toBe('bridge')
    expect(newestPlanState(state({ rateLimitsSeenAt: now - 7_200_000, source: 'bridge' }), cache)?.source).toBe('cache')
    expect(newestPlanState(null, cache)?.source).toBe('cache')
  })
})

describe('parseBridgeState', () => {
  it('drops malformed windows and fields instead of trusting them', () => {
    const s = parseBridgeState({
      updatedAt: 5,
      rateLimitsSeenAt: 'yesterday',
      five_hour: { used_percentage: '42', resets_at: 1 },
      seven_day: { used_percentage: 18, resets_at: 'soon' },
      model: 7
    })!
    expect(s.rateLimitsSeenAt).toBeNull()
    expect(s.five_hour).toBeNull()
    expect(s.seven_day).toEqual({ used_percentage: 18, resets_at: null })
    expect(s.model).toBeNull()
  })

  it('rejects files without an update time, and non-numbers like NaN', () => {
    expect(parseBridgeState({ five_hour: { used_percentage: 1 } })).toBeNull()
    expect(parseBridgeState(null)).toBeNull()
    expect(parseBridgeState({ updatedAt: 1, five_hour: { used_percentage: Number.NaN } })!.five_hour).toBeNull()
  })
})
