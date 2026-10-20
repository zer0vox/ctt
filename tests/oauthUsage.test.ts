import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  OAuthUsageProvider,
  readClaudeToken,
  tokenFromCredentials,
  type OAuthToken
} from '../src/main/providers/oauthUsage.ts'
import { planStateFromUsage } from '../src/main/providers/planLimits.ts'

const FAKE = 'sk-ant-oat01-FAKE-TOKEN-FOR-TESTS'
const future = (): number => Date.now() + 3_600_000

const usageBody = {
  five_hour: { utilization: 12, resets_at: '2026-10-17T20:00:00+00:00' },
  seven_day: { utilization: 74, resets_at: '2026-10-19T23:00:00+00:00' },
  extra_usage: { utilization: null }
}

function setup(opts: { token?: OAuthToken | null; responses?: Array<() => Response>; enabled?: boolean }) {
  const calls: Array<{ url: string; auth: string | null }> = []
  const queue = [...(opts.responses ?? [])]
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, auth: new Headers(init?.headers).get('authorization') })
    const next = queue.shift()
    if (!next) throw new Error('unexpected request')
    return next()
  }) as typeof fetch
  let enabled = opts.enabled ?? true
  const onChange = vi.fn()
  const token = opts.token === undefined ? { accessToken: FAKE, expiresAt: future() } : opts.token
  const p = new OAuthUsageProvider(
    'unused',
    () => enabled,
    onChange,
    fetchImpl,
    async () => token
  )
  return { p, calls, onChange, setEnabled: (v: boolean) => (enabled = v) }
}

const json =
  (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  () =>
    new Response(JSON.stringify(body), { status, headers })

describe('tokenFromCredentials', () => {
  it('reads the Claude login and ignores everything else', () => {
    expect(
      tokenFromCredentials({
        mcpOAuth: { x: { accessToken: 'mcp' } },
        claudeAiOauth: { accessToken: FAKE, expiresAt: 5 }
      })
    ).toEqual({ accessToken: FAKE, expiresAt: 5 })
    expect(tokenFromCredentials({ mcpOAuth: { x: { accessToken: 'mcp' } } })).toBeNull()
    expect(tokenFromCredentials(null)).toBeNull()
  })

  it('reads <config dir>/.credentials.json off macOS', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pup-creds-'))
    try {
      expect(await readClaudeToken(dir, 'win32')).toBeNull()
      writeFileSync(
        join(dir, '.credentials.json'),
        JSON.stringify({ claudeAiOauth: { accessToken: FAKE, expiresAt: 1 } })
      )
      expect(await readClaudeToken(dir, 'linux')).toEqual({ accessToken: FAKE, expiresAt: 1 })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('planStateFromUsage', () => {
  it('reads five_hour and seven_day', () => {
    const s = planStateFromUsage(usageBody, 1000, 'live')!
    expect(s.five_hour?.used_percentage).toBe(12)
    expect(s.seven_day?.used_percentage).toBe(74)
    expect(s.rateLimitsSeenAt).toBe(1000)
  })

  it('falls back to the limits list', () => {
    const s = planStateFromUsage(
      {
        limits: [
          { kind: 'session', percent: 30, resets_at: null },
          { kind: 'weekly_all', percent: 55, resets_at: '2026-10-19T23:00:00+00:00' }
        ]
      },
      1000,
      'live'
    )!
    expect(s.five_hour).toEqual({ used_percentage: 30, resets_at: null })
    expect(s.seven_day?.used_percentage).toBe(55)
  })

  it('returns null when there are no plan limits', () => {
    expect(planStateFromUsage({ extra_usage: {} }, 1, 'live')).toBeNull()
    expect(planStateFromUsage('nope', 1, 'live')).toBeNull()
  })
})

describe('OAuthUsageProvider', () => {
  afterEach(() => vi.useRealTimers())

  it('fetches usage with the Claude login', async () => {
    const { p, calls } = setup({ responses: [json(usageBody)] })
    await p.refresh()
    expect(calls).toEqual([{ url: 'https://api.anthropic.com/api/oauth/usage', auth: `Bearer ${FAKE}` }])
    expect(p.state()?.seven_day?.used_percentage).toBe(74)
    expect(p.state()?.source).toBe('live')
    expect(p.liveStatus().state).toBe('ok')
  })

  it('does nothing while switched off', async () => {
    const { p, calls } = setup({ enabled: false })
    await p.refresh()
    expect(calls).toHaveLength(0)
    expect(p.state()).toBeNull()
    expect(p.liveStatus().state).toBe('off')
  })

  it('waits for Claude Code to renew an expired login instead of calling the API', async () => {
    const { p, calls } = setup({ token: { accessToken: FAKE, expiresAt: Date.now() - 1 } })
    await p.refresh()
    expect(calls).toHaveLength(0)
    expect(p.liveStatus().state).toBe('expired')
  })

  it('explains a missing login', async () => {
    const { p } = setup({ token: null })
    await p.refresh()
    expect(p.liveStatus().state).toBe('no-login')
  })

  it('treats 401 as an expired login and 404 as unsupported', async () => {
    const a = setup({ responses: [json({}, 401)] })
    await a.p.refresh()
    expect(a.p.liveStatus().state).toBe('expired')
    const b = setup({ responses: [json({}, 404)] })
    await b.p.refresh()
    expect(b.p.liveStatus().state).toBe('unsupported')
  })

  it('keeps the last good reading when a later request fails', async () => {
    const { p } = setup({ responses: [json(usageBody), json({}, 500)] })
    await p.refresh()
    await p.refresh()
    expect(p.liveStatus().state).toBe('error')
    expect(p.state()?.seven_day?.used_percentage).toBe(74)
  })

  it('never puts the token in status messages', async () => {
    for (const r of [
      json({}, 401),
      json({}, 404),
      json({}, 429, { 'retry-after': '30' }),
      json({}, 500),
      () => new Response('x')
    ]) {
      const { p } = setup({ responses: [r] })
      await p.refresh()
      expect(JSON.stringify(p.liveStatus())).not.toContain(FAKE)
    }
  })

  it('only nudges a refresh after the minimum gap', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const { p, calls } = setup({ responses: [json(usageBody), json(usageBody)] })
    p.start()
    await vi.waitFor(() => expect(calls).toHaveLength(1))
    p.nudge(Date.now() + 10_000)
    expect(calls).toHaveLength(1)
    p.nudge(Date.now() + 91_000)
    await vi.waitFor(() => expect(calls).toHaveLength(2))
    p.stop()
  })
})

describe('OAuthUsageProvider reset', () => {
  it('does not let a check that was in flight bring data back after live updates are switched off', async () => {
    let enabled = true
    const held: Array<() => void> = []
    const fetchImpl = (async () => new Response(JSON.stringify(usageBody), { status: 200 })) as typeof fetch
    const readToken = async () => {
      await new Promise<void>((r) => held.push(r))
      return { accessToken: FAKE, expiresAt: future() }
    }
    const p = new OAuthUsageProvider(
      'unused',
      () => enabled,
      () => {},
      fetchImpl,
      readToken
    )
    p.start() // the first check waits on the token
    await vi.waitFor(() => expect(held).toHaveLength(1))
    enabled = false
    p.reset() // the app does this when the setting changes
    await p.refresh()
    expect(p.liveStatus().state).toBe('off')
    held[0]() // the old check finally gets its token
    await new Promise((r) => setTimeout(r, 20))
    enabled = true // only so state() would show data if any had been stored
    expect(p.state()).toBeNull()
    p.stop()
  })
})
