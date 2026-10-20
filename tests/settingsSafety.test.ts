import { chmodSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ safeStorage: { isEncryptionAvailable: () => false } }))
const { DEFAULT_SETTINGS, mergeSettings, SettingsStore } = await import('../src/main/settings.ts')

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pup-safety-'))
})
afterEach(() => {
  for (const [target, mode] of [
    [dir, 0o755],
    [join(dir, 'config.json'), 0o666]
  ] as const) {
    try {
      chmodSync(target, mode)
    } catch {
      // Not created by this test.
    }
  }
  rmSync(dir, { recursive: true, force: true })
})

// Root ignores file permissions, so a read-only folder can't fail a save.
const isRoot = typeof process.getuid === 'function' && process.getuid() === 0

describe('mergeSettings', () => {
  it('drops wrongly typed values from a hand-edited config', () => {
    const s = mergeSettings(DEFAULT_SETTINGS, {
      primary: 7,
      scale: 'big',
      notifications: 'yes',
      position: { x: '1', y: 2 },
      plan: { live: 1 },
      logs: { budget: { amount: '20', metric: 'usd', period: 'day' } },
      api: { monthlyBudgetUsd: '50', balance: { amountUsd: 100, asOf: 'yesterday' } }
    })
    expect(s).toEqual(DEFAULT_SETTINGS)
  })

  it('keeps valid values and rounds positions', () => {
    const s = mergeSettings(DEFAULT_SETTINGS, {
      position: { x: 10.6, y: -0.2 },
      logs: { budget: { amount: 20, metric: 'tokens', period: 'week' } },
      api: { monthlyBudgetUsd: 50, balance: { amountUsd: 100, asOf: '2026-10-01' } }
    })
    expect(s.position).toEqual({ x: 11, y: -0 })
    expect(s.logs.budget).toEqual({ amount: 20, metric: 'tokens', period: 'week' })
    expect(s.api).toMatchObject({ monthlyBudgetUsd: 50, balance: { amountUsd: 100, asOf: '2026-10-01' } })
  })

  it('treats null as "clear" and a missing key as "keep"', () => {
    const base = mergeSettings(DEFAULT_SETTINGS, { logs: { budget: { amount: 5, metric: 'usd', period: 'day' } } })
    expect(mergeSettings(base, { logs: { enabled: false } }).logs.budget).toEqual(base.logs.budget)
    expect(mergeSettings(base, { logs: { budget: null } }).logs.budget).toBeNull()
  })

  it('ignores garbage', () => {
    expect(mergeSettings(DEFAULT_SETTINGS, null)).toEqual(DEFAULT_SETTINGS)
    expect(mergeSettings(DEFAULT_SETTINGS, [1, 2])).toEqual(DEFAULT_SETTINGS)
  })
})

describe('SettingsStore', () => {
  it('loads a corrupt config as defaults', () => {
    writeFileSync(join(dir, 'config.json'), '{ not json')
    expect(new SettingsStore(dir).data).toEqual(DEFAULT_SETTINGS)
  })

  // A read-only file fails a save on Windows; macOS and Linux need a read-only folder.
  it.skipIf(process.platform !== 'win32')(
    'reports a failed save and keeps the previous settings (Windows)',
    async () => {
      const store = new SettingsStore(dir)
      await store.update({ notifications: true })
      chmodSync(join(dir, 'config.json'), 0o444)
      await expect(store.update({ notifications: false })).rejects.toThrow(/Couldn't save settings/)
      expect(store.data.notifications).toBe(true)
      expect(JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8')).notifications).toBe(true)
      expect(readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([])
    }
  )

  it.skipIf(process.platform === 'win32' || isRoot)(
    'reports a failed save and keeps the previous settings (macOS, Linux)',
    async () => {
      const store = new SettingsStore(dir)
      await store.update({ notifications: true })
      chmodSync(dir, 0o555)
      await expect(store.update({ notifications: false })).rejects.toThrow(/Couldn't save settings/)
      expect(store.data.notifications).toBe(true)
      expect(JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8')).notifications).toBe(true)
    }
  )

  it('applies saves in order when they overlap', async () => {
    const store = new SettingsStore(dir)
    await Promise.all([store.update({ scale: 4 }), store.update({ notifications: false }), store.update({ scale: 5 })])
    expect(store.data).toMatchObject({ scale: 5, notifications: false })
    expect(JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8'))).toMatchObject({ scale: 5, notifications: false })
  })
})
