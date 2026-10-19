import { fmtAgo, fmtPct } from '../shared/format.ts'
import { frameFor } from '../shared/sprites/animate.ts'
import { composeScene, PORTRAITS, SCENE_W } from '../shared/sprites/compose.ts'
import { PALETTE, TRANSPARENT } from '../shared/sprites/palette.ts'
import type { BudgetMetric, BudgetPeriod, PetState, SettingsPatch, SettingsView } from '../shared/types.ts'
import { headline } from '../shared/headline.ts'

const pup = window.pup
const $ = <T extends HTMLElement = HTMLInputElement>(id: string): T => document.getElementById(id) as T

const errorBox = $<HTMLParagraphElement>('error')

function showError(e: unknown): void {
  const msg = e instanceof Error ? e.message : String(e)
  // Electron prefixes errors thrown in ipcMain.handle; keep only the message.
  errorBox.textContent = msg.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

async function run<T>(fn: () => Promise<T>): Promise<T | undefined> {
  errorBox.textContent = ''
  try {
    return await fn()
  } catch (e) {
    showError(e)
    return undefined
  }
}

function numOrNull(input: HTMLInputElement): number | null {
  const v = parseFloat(input.value)
  return Number.isFinite(v) && v > 0 ? v : null
}

// ── Render ───────────────────────────────────────────────────────────────
const LIVE_CLASS: Record<SettingsView['live']['state'], string> = {
  off: 'status',
  ok: 'status ok',
  'no-login': 'status warn',
  expired: 'status warn',
  unsupported: 'status warn',
  error: 'status warn'
}

/** Everything, including text fields. Used on load and after this window saves. */
function render(v: SettingsView): void {
  const s = v.settings
  $<HTMLSelectElement>('primary').value = s.primary
  $<HTMLSelectElement>('scale').value = String(s.scale)

  // Unit, period and "as of" are only overwritten when a value is saved, so choosing them
  // before typing the amount doesn't snap them back to the defaults.
  const budget = s.logs.budget
  $('logs-amount').value = budget ? String(budget.amount) : ''
  if (budget) {
    $<HTMLSelectElement>('logs-metric').value = budget.metric
    $<HTMLSelectElement>('logs-period').value = budget.period
  }

  $('api-budget').value = s.api.monthlyBudgetUsd ? String(s.api.monthlyBudgetUsd) : ''
  $('api-balance').value = s.api.balance ? String(s.api.balance.amountUsd) : ''
  if (s.api.balance) $('api-asof').value = s.api.balance.asOf
  renderStatus(v)
}

/** Checkboxes and status lines only, so background updates never overwrite something being typed. */
function renderStatus(v: SettingsView): void {
  const s = v.settings
  $('plan-enabled').checked = s.plan.enabled
  $('plan-live').checked = s.plan.live
  $('plan-live').disabled = !s.plan.enabled
  $('logs-enabled').checked = s.logs.enabled
  $('api-enabled').checked = s.api.enabled
  $('notifications').checked = s.notifications
  $('click-through').checked = s.clickThrough
  $('start-on-login').checked = s.startOnLogin
  $('start-on-login').disabled = !v.isPackaged
  $('login-hint').textContent = v.isPackaged ? '' : 'Start on login is available in the installed app (npm run dist).'

  const live = $<HTMLDivElement>('live-status')
  live.className = LIVE_CLASS[v.live.state]
  live.textContent =
    v.live.state === 'ok' && v.live.lastSuccess
      ? `✓ Live. Last checked ${fmtAgo(v.live.lastSuccess)}.`
      : v.live.state === 'off'
        ? 'Off.'
        : v.live.message

  const bridge = $<HTMLDivElement>('bridge-status')
  if (v.bridge.installed) {
    bridge.className = 'status ok'
    bridge.textContent = v.bridge.lastUpdate
      ? `✓ Bridge installed. Last update from Claude Code ${fmtAgo(v.bridge.lastUpdate)}.`
      : '✓ Bridge installed. Start or continue a Claude Code session to send the first reading.'
  } else {
    bridge.className = 'status warn'
    bridge.textContent = v.bridge.otherCommand
      ? `Not installed. Your current status line (${v.bridge.otherCommand}) will keep working after installing.`
      : 'Not installed.'
  }
  $<HTMLButtonElement>('bridge-install').disabled = v.bridge.installed
  $<HTMLButtonElement>('bridge-remove').disabled = !v.bridge.installed

  const key = $<HTMLDivElement>('key-status')
  if (!v.encryptionAvailable) {
    key.className = 'status warn'
    key.textContent = 'Windows encryption is unavailable, so a key cannot be stored safely.'
  } else {
    key.className = v.apiKeySet ? 'status ok' : 'status'
    key.textContent = v.apiKeySet ? '✓ Admin key saved (encrypted).' : 'No key saved.'
  }
  $<HTMLButtonElement>('key-save').disabled = !v.encryptionAvailable
  $<HTMLButtonElement>('key-clear').disabled = !v.apiKeySet
}

async function save(patch: SettingsPatch): Promise<void> {
  const v = await run(() => pup.saveSettings(patch))
  if (v) render(v)
}

// ── Wire up ──────────────────────────────────────────────────────────────
const onChange = (id: string, fn: () => void): void => $(id).addEventListener('change', fn)

onChange('primary', () => void save({ primary: $<HTMLSelectElement>('primary').value }))
onChange('plan-enabled', () => void save({ plan: { enabled: $('plan-enabled').checked } }))
onChange('plan-live', () => void save({ plan: { live: $('plan-live').checked } }))
onChange('logs-enabled', () => void save({ logs: { enabled: $('logs-enabled').checked } }))
onChange('api-enabled', () => void save({ api: { enabled: $('api-enabled').checked } }))
onChange('scale', () => void save({ scale: Number($<HTMLSelectElement>('scale').value) }))
onChange('notifications', () => void save({ notifications: $('notifications').checked }))
onChange('click-through', () => void save({ clickThrough: $('click-through').checked }))
onChange('start-on-login', () => void save({ startOnLogin: $('start-on-login').checked }))

function saveLogBudget(): void {
  const amount = numOrNull($('logs-amount'))
  void save({
    logs: {
      budget: amount
        ? {
            amount,
            metric: $<HTMLSelectElement>('logs-metric').value as BudgetMetric,
            period: $<HTMLSelectElement>('logs-period').value as BudgetPeriod
          }
        : null
    }
  })
}
for (const id of ['logs-amount', 'logs-metric', 'logs-period']) onChange(id, saveLogBudget)

onChange('api-budget', () => void save({ api: { monthlyBudgetUsd: numOrNull($('api-budget')) } }))
function saveBalance(): void {
  const amountUsd = numOrNull($('api-balance'))
  const asOfInput = $('api-asof')
  if (amountUsd && !asOfInput.value) asOfInput.value = new Date().toISOString().slice(0, 10)
  void save({ api: { balance: amountUsd ? { amountUsd, asOf: asOfInput.value } : null } })
}
onChange('api-balance', saveBalance)
onChange('api-asof', saveBalance)

$('key-save').addEventListener('click', async () => {
  const input = $('api-key')
  if (!input.value.trim()) return
  const v = await run(() => pup.setApiKey(input.value.trim()))
  if (v) {
    input.value = ''
    render(v)
  }
})
$('key-clear').addEventListener('click', async () => {
  const v = await run(() => pup.setApiKey(null))
  if (v) render(v)
})
$('bridge-install').addEventListener('click', async () => {
  const v = await run(() => pup.installBridge())
  if (v) render(v)
})
$('bridge-remove').addEventListener('click', async () => {
  const v = await run(() => pup.uninstallBridge())
  if (v) render(v)
})

// Mood preview drives the real pet window.
const previewOn = $('preview-on')
const previewJoy = $('preview-joy')
const previewOut = $<HTMLOutputElement>('preview-out')
function sendPreview(): void {
  const joy = Number(previewJoy.value) / 100
  previewOut.textContent = `${fmtPct(joy)} left`
  pup.previewJoy(previewOn.checked ? joy : null)
}
previewOn.addEventListener('change', () => {
  previewJoy.disabled = !previewOn.checked
  sendPreview()
})
previewJoy.addEventListener('input', sendPreview)

// ── Header face follows the live mood ────────────────────────────────────
const face = $<HTMLCanvasElement>('face')
const faceCtx = face.getContext('2d')!
function drawFace(state: PetState): void {
  const scale = 2
  const spec = frameFor(state.mood, 5, 1)
  spec.overlays = []
  spec.dy = 0
  const scene = composeScene(spec)
  const crop = PORTRAITS[spec.pose]
  face.width = crop.w * scale
  face.height = crop.h * scale
  faceCtx.clearRect(0, 0, face.width, face.height)
  for (let y = 0; y < crop.h; y++) {
    for (let x = 0; x < crop.w; x++) {
      const idx = scene[(crop.y + y) * SCENE_W + crop.x + x]
      if (idx === TRANSPARENT) continue
      faceCtx.fillStyle = PALETTE[idx].rgb
      faceCtx.fillRect(x * scale, y * scale, scale, scale)
    }
  }
  $<HTMLParagraphElement>('headline').textContent = headline(state)
}

pup.onState(drawFace)
pup.onSettingsChanged(async () => renderStatus(await pup.getSettings()))
void run(async () => {
  render(await pup.getSettings())
  drawFace(await pup.getState())
})
