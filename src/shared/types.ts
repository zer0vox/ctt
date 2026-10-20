export interface UsageSnapshot {
  /** 'plan-5h' | 'plan-7d' | 'logs' | 'api' */
  id: string
  short: string
  label: string
  /** 0..1, null for info-only snapshots with no limit. */
  usedFraction: number | null
  /** Epoch ms. */
  resetsAt?: number
  stale: boolean
  /** Epoch ms. */
  updatedAt: number
  summary: string
  details: string[]
}

export type MoodId = 'ecstatic' | 'happy' | 'content' | 'anxious' | 'sad' | 'exhausted' | 'sniffing'

export interface PetState {
  snapshots: UsageSnapshot[]
  /** Snapshot driving the mood, or 'debug' while previewing. */
  primaryId: string | null
  /** 0..1 remaining on the primary snapshot. */
  joy: number | null
  mood: MoodId
  /** Epoch ms, from the primary snapshot. */
  resetsAt?: number
  /** Limit resets seen so far; the pet celebrates when it goes up. */
  celebrations: number
}

export type BudgetMetric = 'usd' | 'tokens'
export type BudgetPeriod = 'block' | 'day' | 'week' | 'month'

export interface LogBudget {
  metric: BudgetMetric
  period: BudgetPeriod
  amount: number
}

export interface ApiBalance {
  amountUsd: number
  /** YYYY-MM-DD, UTC. */
  asOf: string
}

export interface Settings {
  /** Snapshot id, or 'auto' for the least remaining. */
  primary: string
  scale: number
  clickThrough: boolean
  startOnLogin: boolean
  notifications: boolean
  position: { x: number; y: number } | null
  /** `live` polls the unofficial usage endpoint with the Claude Code login. */
  plan: { enabled: boolean; live: boolean }
  logs: { enabled: boolean; budget: LogBudget | null }
  api: { enabled: boolean; monthlyBudgetUsd: number | null; balance: ApiBalance | null }
}

export interface LiveStatus {
  state: 'off' | 'ok' | 'no-login' | 'expired' | 'unsupported' | 'error'
  message: string
  lastSuccess: number | null
}

export interface BridgeStatus {
  installed: boolean
  /** Someone else's status line command, which gets chained. */
  otherCommand: string | null
  lastUpdate: number | null
}

/** The API key itself never leaves main, only whether one is set. */
export interface SettingsView {
  settings: Settings
  apiKeySet: boolean
  encryptionAvailable: boolean
  bridge: BridgeStatus
  live: LiveStatus
  isPackaged: boolean
}

export type SettingsPatch = Partial<Omit<Settings, 'plan' | 'logs' | 'api'>> & {
  plan?: Partial<Settings['plan']>
  logs?: Partial<Settings['logs']>
  api?: Partial<Settings['api']>
}

/** Exposed by preload as `window.pup`. */
export interface PupApi {
  getState(): Promise<PetState>
  onState(cb: (state: PetState) => void): () => void
  /** Settings changed elsewhere, e.g. from the tray menu. */
  onSettingsChanged(cb: () => void): () => void
  getSettings(): Promise<SettingsView>
  saveSettings(patch: SettingsPatch): Promise<SettingsView>
  setApiKey(key: string | null): Promise<SettingsView>
  installBridge(): Promise<SettingsView>
  uninstallBridge(): Promise<SettingsView>
  previewJoy(joy: number | null): void
  setIgnoreMouse(ignore: boolean): void
  dragStart(offset: { x: number; y: number }): void
  dragEnd(): void
  showContextMenu(): void
}
