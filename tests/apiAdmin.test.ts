import { describe, expect, it, vi } from 'vitest'
import {
  apiSnapshot,
  ApiUsageProvider,
  fetchDailyCost,
  fetchTokens,
  type ApiData
} from '../src/main/providers/apiAdmin.ts'

function mockFetch(pages: Record<string, unknown[]>): { fetch: typeof fetch; calls: string[] } {
  const calls: string[] = []
  const impl = (async (url: string, init?: RequestInit) => {
    calls.push(url)
    expect(new Headers(init?.headers).get('x-api-key')).toBe('sk-ant-admin01-test')
    const u = new URL(url)
    const path = u.pathname.split('/organizations/')[1]
    const list = pages[path] ?? []
    const page = Number(u.searchParams.get('page') ?? 0)
    return new Response(
      JSON.stringify({
        data: list[page],
        has_more: page + 1 < list.length,
        next_page: page + 1 < list.length ? String(page + 1) : null
      }),
      { status: 200 }
    )
  }) as typeof fetch
  return { fetch: impl, calls }
}

describe('fetchDailyCost', () => {
  it('converts cents to dollars and follows pagination', async () => {
    const { fetch, calls } = mockFetch({
      cost_report: [
        [
          {
            starting_at: '2026-10-01T00:00:00Z',
            results: [
              { currency: 'USD', amount: '1234.5' },
              { currency: 'USD', amount: '100' }
            ]
          }
        ],
        [{ starting_at: '2026-10-02T00:00:00Z', results: [{ currency: 'USD', amount: '50' }] }]
      ]
    })
    const days = await fetchDailyCost(fetch, 'sk-ant-admin01-test', '2026-10-01T00:00:00Z')
    expect(days).toEqual([
      { day: '2026-10-01', usd: 13.345 },
      { day: '2026-10-02', usd: 0.5 }
    ])
    expect(calls).toHaveLength(2)
    expect(calls[0]).toContain('bucket_width=1d')
  })

  it('reports HTTP errors without leaking the key', async () => {
    const bad = (async () => new Response('{}', { status: 401 })) as typeof fetch
    await expect(fetchDailyCost(bad, 'sk-ant-admin01-test', '2026-10-01T00:00:00Z')).rejects.toThrow(/401.*Admin key/)
    await fetchDailyCost(bad, 'sk-ant-admin01-test', 'x').catch((e) => expect(String(e)).not.toContain('sk-ant'))
  })
})

describe('fetchTokens', () => {
  it('adds every token type', async () => {
    const { fetch } = mockFetch({
      'usage_report/messages': [
        [
          {
            results: [
              {
                uncached_input_tokens: 10,
                cache_read_input_tokens: 20,
                cache_creation: { ephemeral_1h_input_tokens: 30, ephemeral_5m_input_tokens: 40 },
                output_tokens: 50
              }
            ]
          }
        ]
      ]
    })
    expect(await fetchTokens(fetch, 'sk-ant-admin01-test', '2026-10-01T00:00:00Z')).toBe(150)
  })
})

describe('apiSnapshot', () => {
  const now = Date.UTC(2026, 9, 17, 12)
  const data: ApiData = {
    days: [
      { day: '2026-09-30', usd: 5 },
      { day: '2026-10-01', usd: 10 },
      { day: '2026-10-15', usd: 15 }
    ],
    monthTokens: 1_000_000,
    fetchedAt: now
  }
  const cfg = { enabled: true, monthlyBudgetUsd: null, balance: null }

  it('is info-only without a budget or balance', () => {
    const s = apiSnapshot(data, null, cfg, now)!
    expect(s.usedFraction).toBeNull()
    expect(s.summary).toBe('$25.00 this month')
  })

  it('uses month-to-date cost against a monthly budget', () => {
    const s = apiSnapshot(data, null, { ...cfg, monthlyBudgetUsd: 100 }, now)!
    expect(s.usedFraction).toBeCloseTo(0.25)
    expect(s.resetsAt).toBe(Date.UTC(2026, 10, 1))
  })

  it('estimates a balance from spend since the balance date', () => {
    const s = apiSnapshot(
      data,
      null,
      { ...cfg, monthlyBudgetUsd: 100, balance: { amountUsd: 40, asOf: '2026-10-10' } },
      now
    )!
    expect(s.usedFraction).toBeCloseTo(15 / 40)
    expect(s.summary).toBe('$25.00 left')
  })

  it('shows an error before any data arrives', () => {
    const s = apiSnapshot(null, 'Admin API cost_report: HTTP 401', cfg, now)!
    expect(s.summary).toBe('error')
    expect(s.usedFraction).toBeNull()
  })
})

describe('ApiUsageProvider', () => {
  const cfg = () => ({ enabled: true, monthlyBudgetUsd: 100, balance: null })

  // Never answers, but honours the abort signal like real fetch.
  const hang = ((_url: string, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal!.reason))
    })) as typeof fetch

  it('gives up on a request that hangs instead of stalling for good', async () => {
    const p = new ApiUsageProvider(
      () => 'sk-ant-admin01-test',
      cfg,
      () => {},
      hang,
      50
    )
    await p.refresh()
    expect(p.snapshot()?.details.join(' ')).toMatch(/timed out/)
  })

  it('ignores a refresh that was still running when the key changed', async () => {
    const held: Array<() => void> = []
    // Old-key requests hang until released, then report $90; new-key ones return $0.
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      const key = new Headers(init?.headers).get('x-api-key') ?? ''
      if (key.endsWith('old')) await new Promise<void>((r) => held.push(r))
      const cents = key.endsWith('old') && url.includes('cost_report') ? '9000' : '0'
      const data = [{ starting_at: new Date().toISOString(), results: [{ currency: 'USD', amount: cents }] }]
      return new Response(JSON.stringify({ data, has_more: false }), { status: 200 })
    }) as typeof fetch
    let key = 'sk-ant-admin01-old'
    const p = new ApiUsageProvider(
      () => key,
      cfg,
      () => {},
      fetchImpl
    )
    const old = p.refresh()
    await vi.waitFor(() => expect(held).toHaveLength(2))
    key = 'sk-ant-admin01-new'
    p.reset()
    await p.refresh()
    expect(p.snapshot()?.usedFraction).toBe(0)
    for (const release of held) release()
    await old
    expect(p.snapshot()?.usedFraction).toBe(0)
    p.stop()
  })
})
