// Live and cache payloads are undocumented, so anything unexpected is ignored.

import { existsSync, readFileSync, statSync, watch, type FSWatcher } from 'node:fs'
import { basename, dirname } from 'node:path'
import { fmtAgo, fmtClock, fmtDuration, fmtPct } from '../../shared/format.ts'
import type { UsageSnapshot } from '../../shared/types.ts'

export interface PlanWindow {
  used_percentage: number
  /** Epoch seconds. */
  resets_at: number | null
}

export interface PlanState {
  updatedAt: number
  rateLimitsSeenAt: number | null
  five_hour: PlanWindow | null
  seven_day: PlanWindow | null
  session_cost_usd: number | null
  context_used_percentage: number | null
  model: string | null
  source?: PlanSource
}

export type PlanSource = 'live' | 'bridge' | 'cache'

export const STALE_AFTER_MS = 30 * 60_000

const WINDOWS = [
  { key: 'five_hour', id: 'plan-5h', short: '5h', label: '5-hour limit' },
  { key: 'seven_day', id: 'plan-7d', short: '7d', label: 'Weekly limit' }
] as const

const SOURCE_LABEL: Record<PlanSource, string> = {
  live: 'your Claude account',
  bridge: 'the status line bridge',
  cache: "Claude Code's usage cache"
}

const REFRESH_HINT: Record<PlanSource, string> = {
  live: 'open Claude Code to refresh your login',
  bridge: 'open Claude Code to refresh',
  cache: 'turn on live updates in Settings, or run /usage in Claude Code'
}

export function planSnapshots(state: PlanState | null, now: number): UsageSnapshot[] {
  if (!state) return []
  const out: UsageSnapshot[] = []
  const source = SOURCE_LABEL[state.source ?? 'bridge']
  const hint = REFRESH_HINT[state.source ?? 'bridge']
  for (const w of WINDOWS) {
    const win = state[w.key]
    if (!win) continue
    const seenAt = state.rateLimitsSeenAt ?? state.updatedAt
    const resetsAt = win.resets_at ? win.resets_at * 1000 : undefined
    if (resetsAt && resetsAt <= now) {
      // Rolled over since the last reading, so the new window starts at 0.
      out.push({
        id: w.id,
        short: w.short,
        label: w.label,
        usedFraction: 0,
        stale: false,
        updatedAt: seenAt,
        summary: 'fresh',
        details: [`${w.label}: reset at ${fmtClock(resetsAt)}`, `Updates when you next use Claude Code (via ${source})`]
      })
      continue
    }
    const used = Math.min(1, Math.max(0, win.used_percentage / 100))
    const stale = now - seenAt > STALE_AFTER_MS
    const details = [`${w.label}: ${fmtPct(used)} used`]
    if (resetsAt) details.push(`Resets ${fmtClock(resetsAt)} (in ${fmtDuration(resetsAt - now)})`)
    details.push(`Updated ${fmtAgo(seenAt, now)} via ${source}${stale ? ` (${hint})` : ''}`)
    out.push({
      id: w.id,
      short: w.short,
      label: w.label,
      usedFraction: used,
      resetsAt,
      stale,
      updatedAt: seenAt,
      summary: `${fmtPct(used)} used`,
      details
    })
  }
  return out
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

function bridgeWindow(w: unknown): PlanWindow | null {
  const win = w as { used_percentage?: unknown; resets_at?: unknown } | null
  const used = num(win?.used_percentage)
  return used === null ? null : { used_percentage: used, resets_at: num(win?.resets_at) }
}

export function parseBridgeState(parsed: unknown): PlanState | null {
  const o = parsed as Record<string, unknown> | null
  if (!o || typeof o !== 'object') return null
  const updatedAt = num(o.updatedAt)
  if (updatedAt === null) return null
  return {
    updatedAt,
    rateLimitsSeenAt: num(o.rateLimitsSeenAt),
    five_hour: bridgeWindow(o.five_hour),
    seven_day: bridgeWindow(o.seven_day),
    session_cost_usd: num(o.session_cost_usd),
    context_used_percentage: num(o.context_used_percentage),
    model: typeof o.model === 'string' ? o.model : null,
    source: 'bridge'
  }
}

export function readPlanState(file: string): PlanState | null {
  try {
    return parseBridgeState(JSON.parse(readFileSync(file, 'utf8')))
  } catch {
    return null
  }
}

function usageWindow(w: unknown): PlanWindow | null {
  const win = w as { utilization?: unknown; percent?: unknown; resets_at?: unknown } | null
  const pct = num(win?.utilization) ?? num(win?.percent)
  if (pct === null) return null
  const resets = typeof win?.resets_at === 'string' ? Date.parse(win.resets_at) : NaN
  return { used_percentage: pct, resets_at: Number.isNaN(resets) ? null : Math.floor(resets / 1000) }
}

/** Parses the live usage response or Claude Code's cached copy of it. */
export function planStateFromUsage(usage: unknown, fetchedAt: number, source: PlanSource): PlanState | null {
  const u = usage as { five_hour?: unknown; seven_day?: unknown; limits?: unknown } | null
  if (!u || typeof u !== 'object') return null
  const limits = Array.isArray(u.limits) ? (u.limits as Array<{ kind?: unknown }>) : []
  const five = usageWindow(u.five_hour) ?? usageWindow(limits.find((l) => l?.kind === 'session'))
  const seven = usageWindow(u.seven_day) ?? usageWindow(limits.find((l) => l?.kind === 'weekly_all'))
  if (!five && !seven) return null
  return {
    updatedAt: fetchedAt,
    rateLimitsSeenAt: fetchedAt,
    five_hour: five,
    seven_day: seven,
    session_cost_usd: null,
    context_used_percentage: null,
    model: null,
    source
  }
}

/** `config` is Claude Code's ~/.claude.json. */
export function parseUsageCache(config: unknown): PlanState | null {
  const cache = (config as { cachedUsageUtilization?: { fetchedAtMs?: unknown; utilization?: unknown } })
    ?.cachedUsageUtilization
  if (!cache || typeof cache.fetchedAtMs !== 'number') return null
  return planStateFromUsage(cache.utilization, cache.fetchedAtMs, 'cache')
}

export function readUsageCache(file: string): PlanState | null {
  try {
    return parseUsageCache(JSON.parse(readFileSync(file, 'utf8')))
  } catch {
    return null
  }
}

export function newestPlanState(...states: Array<PlanState | null>): PlanState | null {
  let best: PlanState | null = null
  for (const s of states) if (s && (!best || (s.rateLimitsSeenAt ?? 0) > (best.rateLimitsSeenAt ?? 0))) best = s
  return best
}

/** Also reloads on a timer, since resets and staleness are time-based. */
export class PlanLimitsProvider {
  private watcher: FSWatcher | null = null
  private timer: NodeJS.Timeout | null = null
  private bridgeState: PlanState | null = null
  private cacheState: PlanState | null = null
  private cacheMtime = 0

  constructor(
    private readonly stateFile: string,
    private readonly cacheFile: string,
    private readonly live: () => PlanState | null,
    private readonly onChange: () => void
  ) {}

  start(): void {
    this.reload()
    this.timer = setInterval(() => this.reload(), 15_000)
  }

  stop(): void {
    this.watcher?.close()
    this.watcher = null
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  snapshots(now = Date.now()): UsageSnapshot[] {
    return planSnapshots(newestPlanState(this.live(), this.bridgeState, this.cacheState), now)
  }

  private watchDir(): void {
    const dir = dirname(this.stateFile)
    if (!existsSync(dir)) return
    try {
      this.watcher = watch(dir, (_event, name) => {
        if (name === basename(this.stateFile)) this.reload()
      })
      // An unhandled fs.watch 'error' event crashes the main process.
      this.watcher.on('error', () => {
        this.watcher?.close()
        this.watcher = null
      })
    } catch {
      // The timer still picks up changes.
    }
  }

  private reload(): void {
    this.bridgeState = readPlanState(this.stateFile)
    try {
      const mtime = statSync(this.cacheFile).mtimeMs
      if (mtime !== this.cacheMtime) {
        this.cacheMtime = mtime
        this.cacheState = readUsageCache(this.cacheFile)
      }
    } catch {
      this.cacheState = null
    }
    if (!this.watcher) this.watchDir()
    this.onChange()
  }
}
