// Types shared by the main process, preload and renderers.

/** One usage reading from one provider, normalised so the mood engine can compare them. */
export interface UsageSnapshot {
  /** 'plan-5h' | 'plan-7d' | 'logs' | 'api' */
  id: string
  /** Short label for the HUD, e.g. "5h". */
  short: string
  /** Long label for menus and tooltips, e.g. "5-hour limit". */
  label: string
  /** 0..1 of the limit used, or null when there is no limit to compare against (info only). */
  usedFraction: number | null
  /** Epoch ms when the limit resets, when known. */
  resetsAt?: number
  /** True when the reading is old and may be out of date. */
  stale: boolean
  /** Epoch ms of the underlying data. */
  updatedAt: number
  /** One-line summary, e.g. "42% used". */
  summary: string
  /** Extra lines for the hover card. */
  details: string[]
}

export type MoodId = 'ecstatic' | 'happy' | 'content' | 'anxious' | 'sad' | 'exhausted' | 'sniffing'

/** What the main process pushes to the pet window. */
export interface PetState {
  snapshots: UsageSnapshot[]
  /** Id of the snapshot driving the mood, 'debug' when previewing, or null. */
  primaryId: string | null
  /** 0..1 remaining for the primary snapshot, or null when nothing has data. */
  joy: number | null
  /** Mood for `joy`, with hysteresis applied. */
  mood: MoodId
  /** Reset time of the primary snapshot, if known. */
  resetsAt?: number
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
  /** YYYY-MM-DD (UTC) the balance was read from the Console. */
  asOf: string
}

export interface Settings {
  /** 'auto' (lowest remaining) or a snapshot id. */
  primary: string
  scale: number
  clickThrough: boolean
  startOnLogin: boolean
  notifications: boolean
  position: { x: number; y: number } | null
  /** `live`: poll Anthropic's usage endpoint with the Claude Code login (opt-in, unofficial). */
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
  /** A status line command that belongs to something else (it gets chained). */
  otherCommand: string | null
  lastUpdate: number | null
}

/** Settings plus read-only status for the settings window. The API key itself never leaves main. */
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

/** The API the preload script exposes on `window.pup`. */
export interface PupApi {
  getState(): Promise<PetState>
  onState(cb: (state: PetState) => void): () => void
  /** Fired when settings change from outside the settings window (e.g. the tray menu). */
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
