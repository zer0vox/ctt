// Undocumented, opt-in. Token read per request, never stored or refreshed.

import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { planStateFromUsage, type PlanState } from './planLimits.ts'

const ENDPOINT = 'https://api.anthropic.com/api/oauth/usage'
const POLL_MS = 5 * 60_000
const NUDGE_MIN_MS = 90_000
const LOGIN_CHECK_MS = 2 * 60_000
const MAX_BACKOFF_MS = 30 * 60_000

export interface OAuthToken {
  accessToken: string
  /** Epoch ms. */
  expiresAt: number | null
}

export type LiveState = 'off' | 'ok' | 'no-login' | 'expired' | 'unsupported' | 'error'

export interface LiveStatus {
  state: LiveState
  message: string
  lastSuccess: number | null
}

export function tokenFromCredentials(json: unknown): OAuthToken | null {
  const o = (json as { claudeAiOauth?: { accessToken?: unknown; expiresAt?: unknown } } | null)?.claudeAiOauth
  if (!o || typeof o.accessToken !== 'string' || !o.accessToken) return null
  return { accessToken: o.accessToken, expiresAt: typeof o.expiresAt === 'number' ? o.expiresAt : null }
}

function keychainCredentials(): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      'security',
      ['find-generic-password', '-s', 'Claude Code-credentials', '-w'],
      { timeout: 5000 },
      (err, out) => resolve(err ? null : out)
    )
  })
}

export async function readClaudeToken(
  claudeDir: string,
  platform: NodeJS.Platform = process.platform
): Promise<OAuthToken | null> {
  if (platform === 'darwin') {
    try {
      const token = tokenFromCredentials(JSON.parse((await keychainCredentials()) ?? 'null'))
      if (token) return token
    } catch {
      // Fall through to the file.
    }
  }
  try {
    return tokenFromCredentials(JSON.parse(await readFile(join(claudeDir, '.credentials.json'), 'utf8')))
  } catch {
    return null
  }
}

type Fetch = typeof fetch
type ReadToken = (claudeDir: string) => Promise<OAuthToken | null>

export class OAuthUsageProvider {
  private data: PlanState | null = null
  private status: LiveStatus = { state: 'off', message: 'Off', lastSuccess: null }
  private timer: NodeJS.Timeout | null = null
  private delay = POLL_MS
  private running = false
  private inFlight: Promise<void> | null = null
  private lastAttempt = 0
  /** Bumped by reset() so a refresh already in flight drops its result. */
  private generation = 0

  constructor(
    private readonly claudeDir: string,
    private readonly enabled: () => boolean,
    private readonly onChange: () => void,
    private readonly fetchImpl: Fetch = fetch,
    private readonly readToken: ReadToken = readClaudeToken
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

  reset(): void {
    this.generation++
    this.inFlight = null
    this.data = null
    this.delay = POLL_MS
    this.lastAttempt = 0
    if (this.running) void this.refresh()
  }

  /** Called while Claude Code is in use. */
  nudge(now = Date.now()): void {
    if (!this.running || this.inFlight || !this.enabled()) return
    if (this.status.state === 'unsupported' || this.status.state === 'error') return // keep the backoff
    if (now - this.lastAttempt >= NUDGE_MIN_MS) void this.refresh()
  }

  state(): PlanState | null {
    return this.enabled() ? this.data : null
  }

  liveStatus(): LiveStatus {
    return this.enabled() ? this.status : { state: 'off', message: 'Off', lastSuccess: this.status.lastSuccess }
  }

  refresh(): Promise<void> {
    if (this.inFlight) return this.inFlight
    const run: Promise<void> = this.doRefresh(this.generation).finally(() => {
      if (this.inFlight === run) this.inFlight = null
    })
    this.inFlight = run
    return run
  }

  private schedule(ms: number): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = this.running ? setTimeout(() => void this.refresh(), ms) : null
  }

  private set(state: LiveState, message: string): void {
    this.status = { ...this.status, state, message }
  }

  private async doRefresh(generation: number): Promise<void> {
    if (this.timer) clearTimeout(this.timer)
    if (!this.enabled()) {
      this.data = null
      this.set('off', 'Off')
      this.onChange()
      return
    }
    const now = Date.now()
    this.lastAttempt = now
    let next = POLL_MS

    const token = await this.readToken(this.claudeDir)
    if (generation !== this.generation) return
    if (!token) {
      this.set('no-login', 'No Claude login found. Sign in to Claude Code with your Claude account (not an API key).')
      next = LOGIN_CHECK_MS
    } else if (token.expiresAt !== null && token.expiresAt <= now) {
      this.set('expired', 'Your Claude login has expired. Open Claude Code and it will renew it.')
      next = LOGIN_CHECK_MS
    } else {
      const wait = await this.fetchUsage(token.accessToken, now, generation)
      if (wait === null) return
      next = wait
    }
    this.onChange()
    this.schedule(next)
  }

  /** Ms until the next attempt, or null if reset() ran meanwhile. */
  private async fetchUsage(accessToken: string, now: number, generation: number): Promise<number | null> {
    let res: Response
    try {
      res = await this.fetchImpl(ENDPOINT, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'anthropic-beta': 'oauth-2025-04-20',
          'Content-Type': 'application/json'
        },
        signal: AbortSignal.timeout(15_000)
      })
    } catch {
      if (generation !== this.generation) return null
      return this.backoff('Could not reach api.anthropic.com.')
    }
    if (generation !== this.generation) return null

    if (res.status === 401 || res.status === 403) {
      this.set('expired', 'Your Claude login was not accepted. Open Claude Code to renew it.')
      return LOGIN_CHECK_MS
    }
    if (res.status === 404) {
      this.set('unsupported', 'This account has no plan usage to show (for example an API-key login).')
      return MAX_BACKOFF_MS
    }
    if (res.status === 429) {
      const retry = Number(res.headers.get('retry-after'))
      return this.backoff('Anthropic asked us to slow down; will retry.', retry > 0 ? retry * 1000 : undefined)
    }
    if (!res.ok) return this.backoff(`Usage request failed (HTTP ${res.status}).`)

    let body: unknown
    try {
      body = await res.json()
    } catch {
      return this.backoff('Usage response was not JSON.')
    }
    if (generation !== this.generation) return null
    const state = planStateFromUsage(body, now, 'live')
    if (!state) {
      this.set('unsupported', 'Anthropic returned no plan limits for this account.')
      return MAX_BACKOFF_MS
    }
    this.data = state
    this.delay = POLL_MS
    this.status = { state: 'ok', message: 'Live', lastSuccess: now }
    return POLL_MS
  }

  private backoff(message: string, retryMs?: number): number {
    this.set('error', message)
    this.delay = Math.min(this.delay * 2, MAX_BACKOFF_MS)
    return Math.max(retryMs ?? 0, this.delay)
  }
}
