import { appendFileSync, mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  blocksOf,
  LogUsageProvider,
  logSnapshot,
  parseUsageLine,
  type UsageRecord
} from '../src/main/providers/ccLogs.ts'
import { estimateCostUsd } from '../src/main/providers/pricing.ts'

function line(opts: {
  id: string
  req?: string
  ts: string
  input?: number
  output?: number
  model?: string
  text?: string
}): string {
  return JSON.stringify({
    type: 'assistant',
    requestId: opts.req ?? `req_${opts.id}`,
    timestamp: opts.ts,
    message: {
      id: opts.id,
      model: opts.model ?? 'claude-opus-5-5',
      content: [{ type: 'text', text: opts.text ?? 'hello' }],
      usage: {
        input_tokens: opts.input ?? 100,
        output_tokens: opts.output ?? 50,
        cache_creation_input_tokens: 1000,
        cache_read_input_tokens: 2000,
        cache_creation: { ephemeral_1h_input_tokens: 1000, ephemeral_5m_input_tokens: 0 }
      }
    }
  })
}

describe('parseUsageLine', () => {
  it('reads usage numbers and nothing else', () => {
    const parsed = parseUsageLine(line({ id: 'msg_1', ts: '2026-10-17T10:00:00Z', text: 'secret prompt' }))
    expect(parsed).not.toBeNull()
    expect(parsed!.key).toBe('msg_1:req_msg_1')
    expect(parsed!.record.tokens).toBe(100 + 50 + 1000 + 2000)
    expect(JSON.stringify(parsed)).not.toContain('secret')
  })

  it('prices with the 1-hour cache write rate', () => {
    const usd = estimateCostUsd('claude-opus-5-5', {
      input: 100,
      output: 50,
      cacheWrite5m: 0,
      cacheWrite1h: 1000,
      cacheRead: 2000
    })
    expect(usd).toBeCloseTo((100 * 4 + 50 * 20 + 1000 * 8 + 2000 * 0.2) / 1e6)
    expect(parseUsageLine(line({ id: 'm', ts: '2026-10-17T10:00:00Z' }))!.record.costUsd).toBeCloseTo(usd)
  })

  it('ignores user lines, synthetic messages and junk', () => {
    expect(parseUsageLine(JSON.stringify({ type: 'user', message: { usage: {} } }))).toBeNull()
    expect(parseUsageLine(line({ id: 'x', ts: '2026-10-17T10:00:00Z', model: '<synthetic>' }))).toBeNull()
    expect(parseUsageLine('{"usage": not json')).toBeNull()
    expect(parseUsageLine('')).toBeNull()
  })
})

describe('blocksOf', () => {
  const rec = (iso: string): UsageRecord => ({ ts: Date.parse(iso), tokens: 1, costUsd: 0 })

  it('starts a block at the hour of the first message and lasts 5 hours', () => {
    const blocks = blocksOf([rec('2026-10-17T09:40:00Z'), rec('2026-10-17T13:59:00Z'), rec('2026-10-17T14:01:00Z')])
    expect(blocks).toHaveLength(2)
    expect(new Date(blocks[0].start).toISOString()).toBe('2026-10-17T09:00:00.000Z')
    expect(new Date(blocks[1].start).toISOString()).toBe('2026-10-17T14:00:00.000Z')
  })
})

describe('logSnapshot', () => {
  const now = new Date(2026, 9, 17, 15, 0).getTime()
  const today = (h: number): UsageRecord => ({ ts: new Date(2026, 9, 17, h, 0).getTime(), tokens: 1000, costUsd: 2 })

  it('is info-only without a budget', () => {
    const s = logSnapshot([today(9), today(14)], null, now)!
    expect(s.usedFraction).toBeNull()
    expect(s.summary).toContain('2.0k')
  })

  it('compares spend with a daily USD budget', () => {
    const s = logSnapshot([today(9), today(14)], { metric: 'usd', period: 'day', amount: 10 }, now)!
    expect(s.usedFraction).toBeCloseTo(0.4)
    expect(s.resetsAt).toBe(new Date(2026, 9, 18).getTime())
  })

  it('caps at fully used', () => {
    const s = logSnapshot([today(14)], { metric: 'tokens', period: 'block', amount: 500 }, now)!
    expect(s.usedFraction).toBe(1)
  })
})

describe('LogUsageProvider', () => {
  let dir: string | null = null
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
    dir = null
  })

  it('reads logs incrementally and counts each response once', async () => {
    dir = mkdtempSync(join(tmpdir(), 'pup-logs-'))
    const project = join(dir, 'c--some-project')
    mkdirSync(project)
    const file = join(project, 'session.jsonl')
    const ts = new Date(Date.now() - 60_000).toISOString()
    // Claude Code logs one line per content block, each with the same usage.
    writeFileSync(file, [line({ id: 'msg_a', ts }), line({ id: 'msg_a', ts }), ''].join('\n'))

    let changes = 0
    const p = new LogUsageProvider(dir, () => changes++)
    await p.scan()
    expect(p.sortedRecords()).toHaveLength(1)

    // A partial line is held until its newline arrives.
    const next = line({ id: 'msg_b', ts })
    appendFileSync(file, next.slice(0, 40))
    await p.scan()
    expect(p.sortedRecords()).toHaveLength(1)
    appendFileSync(file, next.slice(40) + '\n')
    await p.scan()
    expect(p.sortedRecords()).toHaveLength(2)
    expect(changes).toBe(2)
    p.stop()
  })
})

describe('unrecognised models', () => {
  it('are priced at top-tier rates, not $0, and say so', () => {
    const parsed = parseUsageLine(line({ id: 'msg_new', ts: new Date().toISOString(), model: 'claude-nova-9' }))!
    expect(parsed.record.unpriced).toBe(true)
    expect(parsed.record.costUsd).toBeGreaterThan(0)
    const s = logSnapshot([parsed.record], { metric: 'usd', period: 'day', amount: 100 }, Date.now())!
    expect(s.details.join(' ')).toMatch(/unrecognised models/)
  })

  it('leave known models alone', () => {
    expect(parseUsageLine(line({ id: 'm', ts: new Date().toISOString() }))!.record.unpriced).toBeUndefined()
  })
})

describe('LogUsageProvider housekeeping', () => {
  it('forgets log files that were deleted', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pup-prune-'))
    try {
      const ts = new Date().toISOString()
      writeFileSync(join(dir, 'a.jsonl'), line({ id: 'a', ts }) + '\n')
      writeFileSync(join(dir, 'b.jsonl'), line({ id: 'b', ts }) + '\n')
      const p = new LogUsageProvider(dir, () => {})
      await p.scan()
      expect(p.trackedFiles()).toBe(2)
      unlinkSync(join(dir, 'b.jsonl'))
      await p.scan()
      expect(p.trackedFiles()).toBe(1)
      p.stop()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
