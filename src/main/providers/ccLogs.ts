// Claude Code token usage from the local session logs (~/.claude/projects/**/*.jsonl).
// Only numeric usage fields, timestamps, model ids and message ids are read; message
// content is never kept or logged.

import { watch, type FSWatcher } from 'node:fs'
import { open, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { fmtClock, fmtDuration, fmtPct, fmtTokens, fmtUsd } from '../../shared/format.ts'
import type { BudgetPeriod, LogBudget, UsageSnapshot } from '../../shared/types.ts'
import { estimateCostUsd } from './pricing.ts'

export interface UsageRecord {
  ts: number
  tokens: number
  costUsd: number
}

const HOUR = 3_600_000
const BLOCK_MS = 5 * HOUR
const KEEP_MS = 40 * 24 * HOUR
const CHUNK = 8 * 1024 * 1024

/** Parse one JSONL line. Returns null for anything that isn't an assistant message with usage. */
export function parseUsageLine(line: string): { key: string; record: UsageRecord } | null {
  if (!line.includes('"usage"')) return null
  let o: any
  try {
    o = JSON.parse(line)
  } catch {
    return null
  }
  if (o?.type !== 'assistant') return null
  const msg = o.message
  const u = msg?.usage
  if (!u || typeof u !== 'object') return null
  const model: string = typeof msg.model === 'string' ? msg.model : 'unknown'
  if (model === '<synthetic>') return null
  const ts = Date.parse(o.timestamp)
  if (Number.isNaN(ts)) return null

  const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
  const write1h = n(u.cache_creation?.ephemeral_1h_input_tokens)
  const write5m = u.cache_creation ? n(u.cache_creation.ephemeral_5m_input_tokens) : n(u.cache_creation_input_tokens)
  const counts = {
    input: n(u.input_tokens),
    output: n(u.output_tokens),
    cacheWrite5m: write5m,
    cacheWrite1h: write1h,
    cacheRead: n(u.cache_read_input_tokens)
  }
  const tokens = counts.input + counts.output + counts.cacheWrite5m + counts.cacheWrite1h + counts.cacheRead
  // Claude Code logs one line per content block of the same response, all with the same usage.
  const key = msg.id ? `${msg.id}:${o.requestId ?? ''}` : String(o.uuid ?? `${ts}:${tokens}`)
  return { key, record: { ts, tokens, costUsd: estimateCostUsd(model, counts, u.speed === 'fast') } }
}

export interface Block {
  start: number
  end: number
  lastTs: number
}

/** Group records (sorted by time) into 5-hour session blocks, as Claude Code's limits do. */
export function blocksOf(sorted: UsageRecord[]): Block[] {
  const blocks: Block[] = []
  let cur: Block | null = null
  for (const r of sorted) {
    if (!cur || r.ts >= cur.end || r.ts - cur.lastTs >= BLOCK_MS) {
      const start = Math.floor(r.ts / HOUR) * HOUR
      cur = { start, end: start + BLOCK_MS, lastTs: r.ts }
      blocks.push(cur)
    } else {
      cur.lastTs = r.ts
    }
  }
  return blocks
}

export function activeBlock(sorted: UsageRecord[], now: number): Block | null {
  const last = blocksOf(sorted).at(-1)
  return last && now < last.end ? last : null
}

/** Start and end of the budget period that contains `now` (local time). */
export function periodRange(period: BudgetPeriod, sorted: UsageRecord[], now: number): { start: number; end: number } | null {
  const d = new Date(now)
  switch (period) {
    case 'block': {
      const b = activeBlock(sorted, now)
      return b ? { start: b.start, end: b.end } : null
    }
    case 'day': {
      const start = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
      return { start, end: new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime() }
    }
    case 'week': {
      const sinceMonday = (d.getDay() + 6) % 7
      const start = new Date(d.getFullYear(), d.getMonth(), d.getDate() - sinceMonday).getTime()
      return { start, end: new Date(d.getFullYear(), d.getMonth(), d.getDate() - sinceMonday + 7).getTime() }
    }
    case 'month':
      return {
        start: new Date(d.getFullYear(), d.getMonth(), 1).getTime(),
        end: new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime()
      }
  }
}

function sumSince(sorted: UsageRecord[], start: number): { tokens: number; usd: number } {
  let tokens = 0
  let usd = 0
  for (let i = sorted.length - 1; i >= 0 && sorted[i].ts >= start; i--) {
    tokens += sorted[i].tokens
    usd += sorted[i].costUsd
  }
  return { tokens, usd }
}

const PERIOD_LABEL: Record<BudgetPeriod, string> = {
  block: 'this 5h block',
  day: 'today',
  week: 'this week',
  month: 'this month'
}

export function logSnapshot(sorted: UsageRecord[], budget: LogBudget | null, now: number): UsageSnapshot | null {
  if (!sorted.length) return null
  const today = sumSince(sorted, periodRange('day', sorted, now)!.start)
  const block = activeBlock(sorted, now)
  const blockSum = block ? sumSince(sorted, block.start) : null
  const month = sumSince(sorted, periodRange('month', sorted, now)!.start)
  const details = [
    `Today: ${fmtTokens(today.tokens)} tokens · ~${fmtUsd(today.usd)}`,
    blockSum && block
      ? `5h block: ${fmtTokens(blockSum.tokens)} · ~${fmtUsd(blockSum.usd)} (ends ${fmtClock(block.end)})`
      : 'No active 5h block',
    `This month: ${fmtTokens(month.tokens)} · ~${fmtUsd(month.usd)}`
  ]
  const base = {
    id: 'logs',
    short: 'CC',
    label: 'Claude Code',
    stale: false,
    updatedAt: sorted.at(-1)!.ts
  }

  if (!budget || !(budget.amount > 0)) {
    return {
      ...base,
      usedFraction: null,
      summary: `${fmtTokens(today.tokens)} tok today`,
      details: [...details, 'Set a budget in Settings to let this drive the mood']
    }
  }

  const range = periodRange(budget.period, sorted, now)
  const spent = range ? sumSince(sorted, range.start) : { tokens: 0, usd: 0 }
  const value = budget.metric === 'usd' ? spent.usd : spent.tokens
  const used = Math.min(1, value / budget.amount)
  const fmt = (v: number): string => (budget.metric === 'usd' ? fmtUsd(v) : fmtTokens(v))
  const line = `${fmt(value)} of ${fmt(budget.amount)} ${PERIOD_LABEL[budget.period]}`
  return {
    ...base,
    label: 'Claude Code budget',
    usedFraction: used,
    resetsAt: range?.end,
    summary: `${fmtPct(used)} used`,
    details: [
      `Budget: ${line} (${fmtPct(used)})`,
      ...(range ? [`Resets ${fmtClock(range.end)} (in ${fmtDuration(range.end - now)})`] : []),
      ...details
    ]
  }
}

/** Tails every session log incrementally and keeps the last ~40 days of usage records. */
export class LogUsageProvider {
  private files = new Map<string, { size: number; leftover: Buffer }>()
  private seen = new Map<string, number>()
  private records: UsageRecord[] = []
  private sorted = true
  private watcher: FSWatcher | null = null
  private timer: NodeJS.Timeout | null = null
  private debounce: NodeJS.Timeout | null = null
  private scanning: Promise<void> | null = null
  private rescan = false

  constructor(
    private readonly root: string,
    private readonly onChange: () => void
  ) {}

  start(): void {
    void this.scan()
    this.timer = setInterval(() => void this.scan(), 30_000)
  }

  stop(): void {
    this.watcher?.close()
    this.watcher = null
    if (this.timer) clearInterval(this.timer)
    if (this.debounce) clearTimeout(this.debounce)
    this.timer = this.debounce = null
  }

  snapshot(budget: LogBudget | null, now = Date.now()): UsageSnapshot | null {
    return logSnapshot(this.sortedRecords(), budget, now)
  }

  /** Exposed for tests. */
  sortedRecords(): UsageRecord[] {
    if (!this.sorted) {
      this.records.sort((a, b) => a.ts - b.ts)
      this.sorted = true
    }
    return this.records
  }

  scan(): Promise<void> {
    if (this.scanning) {
      this.rescan = true
      return this.scanning
    }
    this.scanning = this.doScan().finally(() => {
      this.scanning = null
      if (this.rescan) {
        this.rescan = false
        void this.scan()
      }
    })
    return this.scanning
  }

  private async doScan(): Promise<void> {
    let names: string[]
    try {
      names = (await readdir(this.root, { recursive: true })).filter((n) => n.endsWith('.jsonl'))
    } catch {
      return // No Claude Code logs yet.
    }
    if (!this.watcher) this.watchRoot()

    const now = Date.now()
    const before = this.records.length
    for (const name of names) {
      const file = join(this.root, name)
      let st
      try {
        st = await stat(file)
      } catch {
        continue
      }
      const known = this.files.get(file)
      if (!known) {
        // Old files can't contribute to any budget period; just remember where they end.
        if (st.mtimeMs < now - KEEP_MS) {
          this.files.set(file, { size: st.size, leftover: Buffer.alloc(0) })
          continue
        }
        await this.readFrom(file, 0, st.size)
      } else if (st.size > known.size) {
        await this.readFrom(file, known.size, st.size)
      } else if (st.size < known.size) {
        // Rewritten: read it again; de-duplication drops what we already have.
        known.leftover = Buffer.alloc(0)
        await this.readFrom(file, 0, st.size)
      }
    }
    this.prune(now)
    if (this.records.length !== before) this.onChange()
  }

  private async readFrom(file: string, from: number, to: number): Promise<void> {
    const entry = this.files.get(file) ?? { size: 0, leftover: Buffer.alloc(0) }
    if (from === 0) entry.leftover = Buffer.alloc(0)
    let fh
    try {
      fh = await open(file, 'r')
      let pos = from
      while (pos < to) {
        const len = Math.min(CHUNK, to - pos)
        const buf = Buffer.alloc(len)
        const { bytesRead } = await fh.read(buf, 0, len, pos)
        if (!bytesRead) break
        pos += bytesRead
        const data = entry.leftover.length ? Buffer.concat([entry.leftover, buf.subarray(0, bytesRead)]) : buf.subarray(0, bytesRead)
        const lastNl = data.lastIndexOf(0x0a)
        if (lastNl < 0) {
          entry.leftover = Buffer.from(data)
          continue
        }
        // Split on whole lines only, so multi-byte characters never get cut in half.
        for (const line of data.subarray(0, lastNl).toString('utf8').split('\n')) this.ingest(line)
        entry.leftover = Buffer.from(data.subarray(lastNl + 1))
      }
      entry.size = pos
    } catch {
      // File vanished or is locked; try again next scan.
    } finally {
      await fh?.close()
    }
    this.files.set(file, entry)
  }

  private ingest(line: string): void {
    const parsed = parseUsageLine(line)
    if (!parsed || this.seen.has(parsed.key)) return
    this.seen.set(parsed.key, parsed.record.ts)
    const last = this.records.at(-1)
    if (last && parsed.record.ts < last.ts) this.sorted = false
    this.records.push(parsed.record)
  }

  private prune(now: number): void {
    const cutoff = now - KEEP_MS
    if (this.records.length && this.sortedRecords()[0].ts < cutoff) {
      this.records = this.records.filter((r) => r.ts >= cutoff)
    }
    for (const [key, ts] of this.seen) if (ts < cutoff) this.seen.delete(key)
  }

  private watchRoot(): void {
    try {
      this.watcher = watch(this.root, { recursive: true }, (_event, name) => {
        if (name && !String(name).endsWith('.jsonl')) return
        if (this.debounce) clearTimeout(this.debounce)
        this.debounce = setTimeout(() => void this.scan(), 1000)
      })
      // An unhandled 'error' (e.g. EPERM when ~/.claude/projects is deleted) would crash the main
      // process. Drop the watcher; the 30s scan re-arms it once the folder is back.
      this.watcher.on('error', () => {
        this.watcher?.close()
        this.watcher = null
      })
    } catch {
      // The 30s timer still picks up changes.
    }
  }
}
