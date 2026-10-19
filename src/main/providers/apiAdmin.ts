// Anthropic API spend via the Admin API's Usage & Cost endpoints.
// There is no endpoint for a prepaid balance, so "remaining" is either a monthly budget
// minus month-to-date cost, or a balance the user typed in minus the cost since that date.

import { fmtClock, fmtDuration, fmtPct, fmtTokens, fmtUsd } from '../../shared/format.ts'
import type { ApiBalance, Settings, UsageSnapshot } from '../../shared/types.ts'

const BASE = 'https://api.anthropic.com/v1/organizations'
const POLL_MS = 5 * 60_000
const MAX_BACKOFF_MS = 60 * 60_000

type Fetch = typeof fetch

export interface DayCost {
  /** YYYY-MM-DD (UTC) */
  day: string
  usd: number
}

async function getAll(fetchImpl: Fetch, key: string, path: string, params: Record<string, string>): Promise<any[]> {
  const data: any[] = []
  let page: string | null = null
  for (let i = 0; i < 20; i++) {
    const qs = new URLSearchParams(params)
    if (page) qs.set('page', page)
    const res = await fetchImpl(`${BASE}/${path}?${qs}`, {
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' }
    })
    if (!res.ok) {
      // Never include the key or headers in the error.
      const hint = res.status === 401 || res.status === 403 ? ' (check the Admin key)' : ''
      throw new Error(`Admin API ${path}: HTTP ${res.status}${hint}`)
    }
    const body = (await res.json()) as { data?: any[]; has_more?: boolean; next_page?: string | null }
    data.push(...(body.data ?? []))
    if (!body.has_more || !body.next_page) break
    page = body.next_page
  }
  return data
}

/** Daily cost in USD. The API reports amounts as decimal strings in cents. */
export async function fetchDailyCost(fetchImpl: Fetch, key: string, startingAt: string): Promise<DayCost[]> {
  const buckets = await getAll(fetchImpl, key, 'cost_report', { starting_at: startingAt, bucket_width: '1d', limit: '31' })
  return buckets.map((b) => ({
    day: String(b.starting_at).slice(0, 10),
    usd: (b.results ?? [])
      .filter((r: any) => !r.currency || r.currency === 'USD')
      .reduce((sum: number, r: any) => sum + (parseFloat(r.amount) || 0) / 100, 0)
  }))
}

/** Total tokens (input, cache and output) since `startingAt`. */
export async function fetchTokens(fetchImpl: Fetch, key: string, startingAt: string): Promise<number> {
  const buckets = await getAll(fetchImpl, key, 'usage_report/messages', {
    starting_at: startingAt,
    bucket_width: '1d',
    limit: '31'
  })
  let total = 0
  for (const b of buckets) {
    for (const r of b.results ?? []) {
      total +=
        (r.uncached_input_tokens ?? 0) +
        (r.cache_read_input_tokens ?? 0) +
        (r.cache_creation?.ephemeral_1h_input_tokens ?? 0) +
        (r.cache_creation?.ephemeral_5m_input_tokens ?? 0) +
        (r.output_tokens ?? 0)
    }
  }
  return total
}

function utcMonthStart(now: number): Date {
  const d = new Date(now)
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1))
}

export interface ApiData {
  days: DayCost[]
  monthTokens: number
  fetchedAt: number
}

export function apiSnapshot(
  data: ApiData | null,
  error: string | null,
  cfg: Settings['api'],
  now: number
): UsageSnapshot | null {
  const base = { id: 'api', short: 'API', label: 'API credits' }
  if (!data) {
    return error
      ? { ...base, usedFraction: null, stale: true, updatedAt: now, summary: 'error', details: [error] }
      : null
  }
  const monthStart = utcMonthStart(now).toISOString().slice(0, 10)
  const mtd = data.days.filter((d) => d.day >= monthStart).reduce((s, d) => s + d.usd, 0)
  const details = [`Month to date: ${fmtUsd(mtd)} · ${fmtTokens(data.monthTokens)} tokens`]
  if (error) details.push(`Last refresh failed: ${error}`)
  const stale = now - data.fetchedAt > 3 * POLL_MS

  const balance: ApiBalance | null = cfg.balance && cfg.balance.amountUsd > 0 ? cfg.balance : null
  if (balance) {
    const spent = data.days.filter((d) => d.day >= balance.asOf).reduce((s, d) => s + d.usd, 0)
    const left = Math.max(0, balance.amountUsd - spent)
    const used = Math.min(1, spent / balance.amountUsd)
    return {
      ...base,
      usedFraction: used,
      stale,
      updatedAt: data.fetchedAt,
      summary: `${fmtUsd(left)} left`,
      details: [`Estimated balance: ${fmtUsd(left)} of ${fmtUsd(balance.amountUsd)} (since ${balance.asOf})`, ...details]
    }
  }
  if (cfg.monthlyBudgetUsd && cfg.monthlyBudgetUsd > 0) {
    const used = Math.min(1, mtd / cfg.monthlyBudgetUsd)
    const d = new Date(now)
    const resetsAt = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)
    return {
      ...base,
      usedFraction: used,
      resetsAt,
      stale,
      updatedAt: data.fetchedAt,
      summary: `${fmtPct(used)} used`,
      details: [
        `Budget: ${fmtUsd(mtd)} of ${fmtUsd(cfg.monthlyBudgetUsd)} this month`,
        `Resets ${fmtClock(resetsAt)} (in ${fmtDuration(resetsAt - now)})`,
        ...details
      ]
    }
  }
  return {
    ...base,
    usedFraction: null,
    stale,
    updatedAt: data.fetchedAt,
    summary: `${fmtUsd(mtd)} this month`,
    details: [...details, 'Set a budget or balance in Settings to let this drive the mood']
  }
}

export class ApiUsageProvider {
  private data: ApiData | null = null
  private error: string | null = null
  private timer: NodeJS.Timeout | null = null
  private delay = POLL_MS
  private running = false

  constructor(
    private readonly getKey: () => string | null,
    private readonly getConfig: () => Settings['api'],
    private readonly onChange: () => void,
    private readonly fetchImpl: Fetch = fetch
  ) {}

  start(): void {
    this.running = true
    void this.refresh()
  }

  stop(): void {
    this.running = false
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  /** Forget cached data (e.g. the key changed) and fetch again. */
  reset(): void {
    this.data = null
    this.error = null
    this.delay = POLL_MS
    if (this.timer) clearTimeout(this.timer)
    if (this.running) void this.refresh()
    else this.onChange()
  }

  snapshot(now = Date.now()): UsageSnapshot | null {
    if (!this.getKey()) return null
    return apiSnapshot(this.data, this.error, this.getConfig(), now)
  }

  async refresh(): Promise<void> {
    if (this.timer) clearTimeout(this.timer)
    const key = this.getKey()
    if (!key) {
      this.onChange()
      return
    }
    try {
      const now = Date.now()
      const monthStart = utcMonthStart(now)
      const asOf = this.getConfig().balance?.asOf
      const from = asOf && asOf < monthStart.toISOString().slice(0, 10) ? `${asOf}T00:00:00Z` : monthStart.toISOString()
      const [days, monthTokens] = await Promise.all([
        fetchDailyCost(this.fetchImpl, key, from),
        fetchTokens(this.fetchImpl, key, monthStart.toISOString())
      ])
      this.data = { days, monthTokens, fetchedAt: now }
      this.error = null
      this.delay = POLL_MS
    } catch (e) {
      this.error = e instanceof Error ? e.message : 'Request failed'
      this.delay = Math.min(this.delay * 2, MAX_BACKOFF_MS)
    }
    this.onChange()
    if (this.running) this.timer = setTimeout(() => void this.refresh(), this.delay)
  }
}
