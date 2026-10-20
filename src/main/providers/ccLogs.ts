// Only usage numbers are read from the session logs, never message content.

import { watch, type FSWatcher } from 'node:fs'
import { open, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { fmtClock, fmtDuration, fmtPct, fmtTokens, fmtUsd } from '../../shared/format.ts'
import type { BudgetPeriod, LogBudget, UsageSnapshot } from '../../shared/types.ts'
import { estimateCostUsd, isPriced } from './pricing.ts'

export interface UsageRecord {
  ts: number
  tokens: number
  costUsd: number
  /** Model not in the price table, so costUsd is a top-tier estimate. */
  unpriced?: boolean
}

const HOUR = 3_600_000
const BLOCK_MS = 5 * HOUR
const KEEP_MS = 40 * 24 * HOUR
const CHUNK = 8 * 1024 * 1024

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
  // Claude Code logs one line per content block, so de-dupe by message id + request id.
  const key = msg.id ? `${msg.id}:${o.requestId ?? ''}` : String(o.uuid ?? `${ts}:${tokens}`)
  const record: UsageRecord = { ts, tokens, costUsd: estimateCostUsd(model, counts, u.speed === 'fast') }
  if (!isPriced(model)) record.unpriced = true
  return { key, record }
}

export interface Block {
  start: number
  end: number
  lastTs: number
}

/** 5-hour session blocks, matching Claude Code's limit windows. */
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

/** Period boundaries are in local time. */
export function periodRange(
  period: BudgetPeriod,
  sorted: UsageRecord[],
  now: number
): { start: number; end: number } | null {
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

interface Totals {
  tokens: number
  usd: number
  unpriced: number
}

function sumSince(sorted: UsageRecord[], start: number): Totals {
  const t: Totals = { tokens: 0, usd: 0, unpriced: 0 }
  for (let i = sorted.length - 1; i >= 0 && sorted[i].ts >= start; i--) {
    t.tokens += sorted[i].tokens
    t.usd += sorted[i].costUsd
    if (sorted[i].unpriced) t.unpriced += sorted[i].tokens
  }
  return t
}

function unpricedNote(t: Totals): string[] {
  return t.unpriced ? [`${fmtTokens(t.unpriced)} tokens from unrecognised models, priced at top-tier rates`] : []
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
      details: [...details, ...unpricedNote(today), 'Set a budget in Settings to let this drive the mood']
    }
  }

  const range = periodRange(budget.period, sorted, now)
  const spent = range ? sumSince(sorted, range.start) : { tokens: 0, usd: 0, unpriced: 0 }
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
      ...unpricedNote(spent),
      ...details
    ]
  }
}

const FULL_SCAN_MS = 5 * 60_000
const POLL_MS = 30_000

export class LogUsageProvider {
  private files = new Map<string, { size: number; leftover: Buffer }>()
  private seen = new Map<string, number>()
  private records: UsageRecord[] = []
  private sorted = true
  private watcher: FSWatcher | null = null
  private timer: NodeJS.Timeout | null = null
  private debounce: NodeJS.Timeout | null = null
  private wantFull = false
  private dirty = new Set<string>()
  private working: Promise<void> | null = null
  private lastFullScan = 0

  constructor(
    private readonly root: string,
    private readonly onChange: () => void
  ) {}

  start(): void {
    void this.scan()
    this.timer = setInterval(() => {
      if (!this.watcher || Date.now() - this.lastFullScan >= FULL_SCAN_MS) void this.scan()
    }, POLL_MS)
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

  sortedRecords(): UsageRecord[] {
    if (!this.sorted) {
      this.records.sort((a, b) => a.ts - b.ts)
      this.sorted = true
    }
    return this.records
  }

  /** Exposed for tests. */
  trackedFiles(): number {
    return this.files.size
  }

  /** Resolves once a pass started after this call has finished. */
  scan(): Promise<void> {
    this.wantFull = true
    return (this.working ?? Promise.resolve()).then(() => this.drain())
  }

  private drain(): Promise<void> {
    if (!this.working) {
      this.working = this.work().finally(() => {
        this.working = null
        if (this.wantFull || this.dirty.size) void this.drain()
      })
    }
    return this.working
  }

  private async work(): Promise<void> {
    while (this.wantFull || this.dirty.size) {
      const before = this.records.length
      if (this.wantFull) {
        this.wantFull = false
        this.dirty.clear()
        await this.fullScan()
      } else {
        const files = [...this.dirty]
        this.dirty.clear()
        for (const file of files) await this.readChanged(file)
      }
      this.prune(Date.now())
      if (this.records.length !== before) this.onChange()
    }
  }

  private async fullScan(): Promise<void> {
    this.lastFullScan = Date.now()
    let names: string[]
    try {
      names = (await readdir(this.root, { recursive: true })).filter((n) => n.endsWith('.jsonl'))
    } catch {
      return // no logs yet
    }
    if (!this.watcher) this.watchRoot()
    const present = new Set(names.map((n) => join(this.root, n)))
    for (const file of this.files.keys()) if (!present.has(file)) this.files.delete(file)
    for (const file of present) await this.readChanged(file)
  }

  private async readChanged(file: string): Promise<void> {
    let st
    try {
      st = await stat(file)
    } catch {
      this.files.delete(file)
      return
    }
    const known = this.files.get(file)
    if (!known) {
      // Too old for any budget period, so only record where it ends.
      if (st.mtimeMs < Date.now() - KEEP_MS) {
        this.files.set(file, { size: st.size, leftover: Buffer.alloc(0) })
        return
      }
      await this.readFrom(file, 0, st.size)
    } else if (st.size > known.size) {
      await this.readFrom(file, known.size, st.size)
    } else if (st.size < known.size) {
      // Rewritten, so re-read from the start. De-dupe drops known records.
      known.leftover = Buffer.alloc(0)
      await this.readFrom(file, 0, st.size)
    }
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
        const data = entry.leftover.length
          ? Buffer.concat([entry.leftover, buf.subarray(0, bytesRead)])
          : buf.subarray(0, bytesRead)
        const lastNl = data.lastIndexOf(0x0a)
        if (lastNl < 0) {
          entry.leftover = Buffer.from(data)
          continue
        }
        // Splitting on whole lines keeps multi-byte characters intact.
        for (const line of data.subarray(0, lastNl).toString('utf8').split('\n')) this.ingest(line)
        entry.leftover = Buffer.from(data.subarray(lastNl + 1))
      }
      entry.size = pos
    } catch {
      // Vanished or locked, retried on the next scan.
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
        if (name) this.dirty.add(join(this.root, String(name)))
        else this.wantFull = true
        if (this.debounce) clearTimeout(this.debounce)
        this.debounce = setTimeout(() => void this.drain(), 500)
      })
      // An unhandled fs.watch 'error' event crashes the main process.
      this.watcher.on('error', () => {
        this.watcher?.close()
        this.watcher = null
      })
    } catch {
      // Polling still picks up changes.
    }
  }
}
