// Settings must never crash the app: bad values in config.json or IPC patches are ignored, and a
// save that fails leaves the in-memory settings untouched and reports why.
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
  try {
    chmodSync(join(dir, 'config.json'), 0o666)
  } catch {
    // No config written.
  }
  rmSync(dir, { recursive: true, force: true })
})

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

  it('reports a failed save and keeps the previous settings', () => {
    const store = new SettingsStore(dir)
    store.update({ notifications: true })
    chmodSync(join(dir, 'config.json'), 0o444) // read-only, like a locked file on Windows
    expect(() => store.update({ notifications: false })).toThrow(/Couldn't save settings/)
    expect(store.data.notifications).toBe(true)
    expect(JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8')).notifications).toBe(true)
  })
})
