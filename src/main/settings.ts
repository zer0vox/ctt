import { safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ApiBalance, BudgetMetric, BudgetPeriod, LogBudget, Settings, SettingsPatch } from '../shared/types.ts'

export const DEFAULT_SETTINGS: Settings = {
  primary: 'auto',
  scale: 3,
  clickThrough: false,
  startOnLogin: false,
  notifications: true,
  position: null,
  plan: { enabled: true, live: false },
  logs: { enabled: true, budget: null },
  api: { enabled: true, monthlyBudgetUsd: null, balance: null }
}

/**
 * Bumped when a size step changes meaning. v0.1 drew a 48x40 scene; the German Shepherd's scene
 * is 64x64, so a size saved before then moves one step down to stay about as big on screen.
 */
const SIZE_VERSION = 2

// ── Validation ───────────────────────────────────────────────────────────
// config.json can be hand-edited, half-written or from another version, and renderer patches
// arrive over IPC. Every field is checked; anything invalid keeps the previous value.

const METRICS: readonly BudgetMetric[] = ['usd', 'tokens']
const PERIODS: readonly BudgetPeriod[] = ['block', 'day', 'week', 'month']

const isBool = (v: unknown): v is boolean => typeof v === 'boolean'
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isStr = (v: unknown): v is string => typeof v === 'string'
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}

function pick<T>(v: unknown, ok: (v: unknown) => v is T, fallback: T): T {
  return ok(v) ? v : fallback
}

/** `null` clears, a valid value replaces, a missing or invalid one keeps `fallback`. */
function nullable<T>(source: Record<string, unknown>, key: string, parse: (v: unknown) => T | undefined, fallback: T | null): T | null {
  if (!(key in source)) return fallback
  const v = source[key]
  if (v === null) return null
  return parse(v) ?? fallback
}

const positive = (v: unknown): number | undefined => (isNum(v) && v > 0 ? v : undefined)

function budget(v: unknown): LogBudget | undefined {
  const b = obj(v)
  const metric = METRICS.find((m) => m === b.metric)
  const period = PERIODS.find((p) => p === b.period)
  return positive(b.amount) && metric && period ? { amount: b.amount as number, metric, period } : undefined
}

function balance(v: unknown): ApiBalance | undefined {
  const b = obj(v)
  return positive(b.amountUsd) && isStr(b.asOf) && /^\d{4}-\d{2}-\d{2}$/.test(b.asOf)
    ? { amountUsd: b.amountUsd as number, asOf: b.asOf }
    : undefined
}

function position(v: unknown): { x: number; y: number } | undefined {
  const p = obj(v)
  return isNum(p.x) && isNum(p.y) ? { x: Math.round(p.x), y: Math.round(p.y) } : undefined
}

/** Apply `raw` (a saved config or a patch) on top of `base`, keeping only valid values. */
export function mergeSettings(base: Settings, raw: unknown): Settings {
  const r = obj(raw)
  const plan = obj(r.plan)
  const logs = obj(r.logs)
  const api = obj(r.api)
  return {
    primary: pick(r.primary, isStr, base.primary),
    scale: Math.min(5, Math.max(2, Math.round(pick(r.scale, isNum, base.scale)))),
    clickThrough: pick(r.clickThrough, isBool, base.clickThrough),
    startOnLogin: pick(r.startOnLogin, isBool, base.startOnLogin),
    notifications: pick(r.notifications, isBool, base.notifications),
    position: nullable(r, 'position', position, base.position),
    plan: {
      enabled: pick(plan.enabled, isBool, base.plan.enabled),
      live: pick(plan.live, isBool, base.plan.live)
    },
    logs: {
      enabled: pick(logs.enabled, isBool, base.logs.enabled),
      budget: nullable(logs, 'budget', budget, base.logs.budget)
    },
    api: {
      enabled: pick(api.enabled, isBool, base.api.enabled),
      monthlyBudgetUsd: nullable(api, 'monthlyBudgetUsd', positive, base.api.monthlyBudgetUsd),
      balance: nullable(api, 'balance', balance, base.api.balance)
    }
  }
}

// ── Saving ───────────────────────────────────────────────────────────────

/** Windows reports these while antivirus or the search indexer briefly holds a file open. */
const TRANSIENT = new Set(['EPERM', 'EBUSY', 'EACCES'])

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function writeAtomic(file: string, data: string | Buffer): void {
  const tmp = `${file}.tmp`
  writeFileSync(tmp, data)
  for (let attempt = 0; ; attempt++) {
    try {
      renameSync(tmp, file)
      return
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code
      if (!code || !TRANSIENT.has(code)) throw e
      if (attempt < 3) {
        sleepSync(25 * (attempt + 1))
        continue
      }
      // Still locked: write in place (not atomic, but better than losing the change).
      writeFileSync(file, data)
      rmSync(tmp, { force: true })
      return
    }
  }
}

/** Settings in config.json; the Admin API key encrypted with the OS keystore (DPAPI on Windows) in api-key.bin. */
export class SettingsStore {
  private readonly file: string
  private readonly keyFile: string
  private cachedKey: string | null | undefined
  /** True when there was no config file yet (first launch). */
  readonly firstRun: boolean
  data: Settings

  constructor(dir: string) {
    mkdirSync(dir, { recursive: true })
    this.file = join(dir, 'config.json')
    this.keyFile = join(dir, 'api-key.bin')
    this.firstRun = !existsSync(this.file)
    this.data = this.load()
  }

  private load(): Settings {
    try {
      const { sizeVersion, ...saved } = obj(JSON.parse(readFileSync(this.file, 'utf8')))
      if (sizeVersion !== SIZE_VERSION && isNum(saved.scale)) saved.scale = Math.max(2, saved.scale - 1)
      return mergeSettings(DEFAULT_SETTINGS, saved)
    } catch {
      return structuredClone(DEFAULT_SETTINGS)
    }
  }

  /**
   * Validate, save, then apply. If the save fails the in-memory settings stay as they were (so
   * nothing claims a change that won't survive a restart) and the error says why.
   */
  update(patch: SettingsPatch): Settings {
    const next = mergeSettings(this.data, patch)
    try {
      writeAtomic(this.file, JSON.stringify({ ...next, sizeVersion: SIZE_VERSION }, null, 2))
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code
      throw new Error(`Couldn't save settings to ${this.file}${code ? ` (${code})` : ''}. Is the file read-only or locked?`)
    }
    this.data = next
    return this.data
  }

  encryptionAvailable(): boolean {
    return safeStorage.isEncryptionAvailable()
  }

  hasApiKey(): boolean {
    return existsSync(this.keyFile)
  }

  getApiKey(): string | null {
    if (this.cachedKey !== undefined) return this.cachedKey
    this.cachedKey = null
    if (this.hasApiKey() && safeStorage.isEncryptionAvailable()) {
      try {
        this.cachedKey = safeStorage.decryptString(readFileSync(this.keyFile))
      } catch {
        // Unreadable (e.g. copied from another Windows account): treat as no key.
      }
    }
    return this.cachedKey
  }

  setApiKey(key: string | null): void {
    this.cachedKey = undefined
    if (!key) {
      rmSync(this.keyFile, { force: true })
      return
    }
    if (!safeStorage.isEncryptionAvailable()) throw new Error('OS encryption is unavailable; the key was not saved')
    writeAtomic(this.keyFile, safeStorage.encryptString(key.trim()))
  }
}
