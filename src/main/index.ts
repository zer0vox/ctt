import {
  app,
  BrowserWindow,
  ipcMain,
  Notification,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type Tray
} from 'electron'
import { homedir } from 'node:os'
import { join } from 'node:path'
import bridgeSource from '../../bridge/statusline.mjs?raw'
import { fmtDuration, fmtPct } from '../shared/format.ts'
import type { PetState, SettingsPatch, SettingsView, UsageSnapshot } from '../shared/types.ts'
import { Aggregator, type MoodChange } from './aggregator.ts'
import {
  bridgeStatus,
  installBridge,
  nodeVersion,
  STATE_FILE,
  uninstallBridge,
  type BridgePaths
} from './installBridge.ts'
import { ApiUsageProvider } from './providers/apiAdmin.ts'
import { LogUsageProvider } from './providers/ccLogs.ts'
import { OAuthUsageProvider } from './providers/oauthUsage.ts'
import { PlanLimitsProvider } from './providers/planLimits.ts'
import { SettingsStore } from './settings.ts'
import { buildMenu, createTray, moodIcon, tooltip } from './tray.ts'
import { createPetWindow, createSettingsWindow, PetDrag, resizePet } from './window.ts'

// Keep all data in %APPDATA%\token-pup, where the status line bridge writes too.
app.setPath('userData', join(app.getPath('appData'), 'token-pup'))
app.setAppUserModelId('com.tokenpup.app')

const dataDir = app.getPath('userData')
const claudeDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')
const bridgePaths: BridgePaths = { claudeSettings: join(claudeDir, 'settings.json'), dataDir }

if (process.argv.includes('--uninstall-bridge')) {
  // Run by the Windows uninstaller (build/installer.nsh) so Claude Code's status line goes back
  // to what it was before Token Pup. No windows, no single-instance lock.
  void uninstallBridge(bridgePaths)
    .catch((e) => console.error(e))
    .finally(() => app.exit(0))
} else if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  const store = new SettingsStore(dataDir)

  let pet: BrowserWindow | null = null
  let settingsWin: BrowserWindow | null = null
  let tray: Tray | null = null
  const drag = new PetDrag()

  let pending: NodeJS.Timeout | null = null
  const scheduleUpdate = (): void => {
    if (pending) return
    pending = setTimeout(() => {
      pending = null
      aggregator.update()
    }, 200)
  }

  // Claude Code keeps its global config (with a cached copy of plan usage) next to the config dir.
  const claudeConfig = process.env.CLAUDE_CONFIG_DIR
    ? join(process.env.CLAUDE_CONFIG_DIR, '.claude.json')
    : join(homedir(), '.claude.json')
  const live = new OAuthUsageProvider(
    claudeDir,
    () => store.data.plan.enabled && store.data.plan.live,
    () => {
      scheduleUpdate()
      settingsWin?.webContents.send('settings-changed')
    }
  )
  const plan = new PlanLimitsProvider(join(dataDir, STATE_FILE), claudeConfig, () => live.state(), scheduleUpdate)
  // New Claude Code activity in the logs is a good moment for a fresh live reading.
  const logs = new LogUsageProvider(join(claudeDir, 'projects'), () => {
    live.nudge()
    scheduleUpdate()
  })
  const api = new ApiUsageProvider(
    () => (store.data.api.enabled ? store.getApiKey() : null),
    () => store.data.api,
    scheduleUpdate
  )

  const collect = (): UsageSnapshot[] => {
    const s = store.data
    const out: Array<UsageSnapshot | null> = [
      ...(s.plan.enabled ? plan.snapshots() : []),
      s.logs.enabled ? logs.snapshot(s.logs.budget) : null,
      api.snapshot()
    ]
    return out.filter((x): x is UsageSnapshot => x !== null)
  }

  const publish = (state: PetState): void => {
    if (pet && !pet.isDestroyed()) pet.webContents.send('state', state)
    // The settings window shows the live face and headline too.
    if (settingsWin && !settingsWin.isDestroyed()) settingsWin.webContents.send('state', state)
    if (tray) {
      tray.setImage(moodIcon(state.mood))
      tray.setToolTip(tooltip(state))
    }
  }

  const notify = ({ from, to, state }: MoodChange): void => {
    if (!from || !store.data.notifications || !Notification.isSupported()) return
    const primary = state.snapshots.find((s) => s.id === state.primaryId)
    const left = state.joy !== null ? fmtPct(state.joy) : ''
    const what = primary?.label ?? 'Usage'
    const wakes = state.resetsAt ? ` Wakes in ${fmtDuration(state.resetsAt - Date.now())}.` : ''
    const rank = ['exhausted', 'sad', 'anxious', 'content', 'happy', 'ecstatic']
    const worse = rank.indexOf(to) < rank.indexOf(from)
    let body: string | null = null
    if (to === 'anxious' && worse) body = `Pup is getting worried: ${what} has ${left} left.`
    else if (to === 'exhausted') body = `Pup is out of kibble: ${what} is used up.${wakes}`
    else if ((from === 'exhausted' || from === 'sad') && rank.indexOf(to) >= rank.indexOf('content'))
      body = `Pup is happy again: ${what} has ${left} left.`
    if (body) new Notification({ title: 'Token Pup', body, icon: moodIcon(to, 4), silent: true }).show()
  }

  const aggregator = new Aggregator(collect, () => store.data.primary, publish, notify)

  /** Errors from tray clicks, drags and timers: log and tell the user instead of throwing out of an event handler. */
  const reportError = (e: unknown): void => {
    console.error(e)
    if (Notification.isSupported()) {
      new Notification({ title: 'Token Pup', body: e instanceof Error ? e.message : String(e), silent: true }).show()
    }
  }

  const view = (): SettingsView => ({
    settings: store.data,
    apiKeySet: store.hasApiKey(),
    encryptionAvailable: store.encryptionAvailable(),
    bridge: bridgeStatus(bridgePaths),
    live: live.liveStatus(),
    isPackaged: app.isPackaged
  })

  const applyClickThrough = (): void => {
    if (pet && !pet.isDestroyed()) pet.setIgnoreMouseEvents(true, { forward: true })
  }

  const setStartOnLogin = (on: boolean): void => {
    if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: on })
  }

  const openSettings = (): void => {
    if (settingsWin && !settingsWin.isDestroyed()) {
      settingsWin.show()
      settingsWin.focus()
      return
    }
    settingsWin = createSettingsWindow(moodIcon('happy', 4))
    // A reloaded settings page starts with the preview switch off, so end any preview too.
    settingsWin.webContents.on('did-start-loading', () => aggregator.setPreview(null))
    settingsWin.on('closed', () => {
      settingsWin = null
      aggregator.setPreview(null)
    })
  }

  const togglePet = (): void => {
    if (!pet || pet.isDestroyed()) return
    if (pet.isVisible()) pet.hide()
    else pet.showInactive()
  }

  const savePatch = async (patch: SettingsPatch): Promise<SettingsView> => {
    const before = store.data
    const s = await store.update(patch)
    if (s.scale !== before.scale && pet && !pet.isDestroyed()) resizePet(pet, s.scale)
    if (s.clickThrough !== before.clickThrough) applyClickThrough()
    if (s.startOnLogin !== before.startOnLogin) setStartOnLogin(s.startOnLogin)
    if (patch.api) api.reset()
    if (patch.plan && (s.plan.live !== before.plan.live || s.plan.enabled !== before.plan.enabled)) live.reset()
    if (pet && !pet.isDestroyed()) pet.webContents.send('settings-changed')
    scheduleUpdate()
    return view()
  }

  /** Save from a tray click: on failure nothing changes and the user is told why. */
  const saveFromMenu = (patch: SettingsPatch): void => {
    savePatch(patch)
      .catch(reportError)
      .finally(() => settingsWin?.webContents.send('settings-changed'))
  }

  const menuActions = {
    petVisible: () => !!pet && !pet.isDestroyed() && pet.isVisible(),
    togglePet,
    clickThrough: () => store.data.clickThrough,
    toggleClickThrough: () => saveFromMenu({ clickThrough: !store.data.clickThrough }),
    startOnLogin: () => store.data.startOnLogin,
    toggleStartOnLogin: app.isPackaged ? () => saveFromMenu({ startOnLogin: !store.data.startOnLogin }) : null,
    openSettings,
    quit: () => app.quit()
  }

  // ── IPC ──────────────────────────────────────────────────────────────────
  // Only our own pages may talk to main, and each handler only answers the window that uses it.
  const devUrl = !app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined
  const ourPage = (url: string | undefined): boolean =>
    !!url && (url.startsWith('file://') || (!!devUrl && url.startsWith(devUrl)))
  type Sender = 'pet' | 'settings' | 'any'
  const allowed = (e: IpcMainEvent | IpcMainInvokeEvent, from: Sender): boolean => {
    if (!ourPage(e.senderFrame?.url)) return false
    if (from === 'pet') return !!pet && !pet.isDestroyed() && e.sender === pet.webContents
    if (from === 'settings') return !!settingsWin && !settingsWin.isDestroyed() && e.sender === settingsWin.webContents
    return true
  }
  const handle = <A extends unknown[], R>(channel: string, from: Sender, fn: (...args: A) => R): void => {
    ipcMain.handle(channel, (e, ...args) => {
      if (!allowed(e, from)) throw new Error(`Blocked ${channel} from an unexpected sender`)
      return fn(...(args as A))
    })
  }
  const on = <A extends unknown[]>(channel: string, from: Sender, fn: (...args: A) => void): void => {
    ipcMain.on(channel, (e, ...args) => {
      if (allowed(e, from)) fn(...(args as A))
    })
  }

  handle('state:get', 'any', () => aggregator.state())
  handle('settings:get', 'any', () => view())
  handle('settings:save', 'settings', (patch: SettingsPatch) => savePatch(patch))
  handle('apikey:set', 'settings', async (key: string | null) => {
    if (key !== null && !/^sk-ant-admin\d*-[\w-]+$/.test(String(key).trim())) {
      throw new Error('That does not look like an Admin API key (sk-ant-admin…). Regular API keys cannot read usage.')
    }
    await store.setApiKey(key)
    api.reset()
    return view()
  })
  handle('bridge:install', 'settings', async () => {
    if (!(await nodeVersion())) {
      throw new Error(
        "Node.js isn't on your PATH, and the status line bridge runs with `node`. Install Node.js from nodejs.org, or use Live updates instead."
      )
    }
    await installBridge(bridgePaths, bridgeSource)
    plan.stop()
    plan.start()
    return view()
  })
  handle('bridge:uninstall', 'settings', async () => {
    await uninstallBridge(bridgePaths)
    return view()
  })
  on('preview:joy', 'settings', (joy: number | null) => {
    aggregator.setPreview(typeof joy === 'number' ? Math.min(1, Math.max(0, joy)) : null)
  })
  on('pet:ignore-mouse', 'pet', (ignore: boolean) => {
    if (!pet || pet.isDestroyed() || drag.active()) return
    if (store.data.clickThrough) pet.setIgnoreMouseEvents(true, { forward: true })
    else pet.setIgnoreMouseEvents(!!ignore, { forward: true })
  })
  on('pet:drag-start', 'pet', (offset: { x: number; y: number }) => {
    if (!pet || pet.isDestroyed() || store.data.clickThrough) return
    const o = { x: Math.round(Number(offset?.x)) || 0, y: Math.round(Number(offset?.y)) || 0 }
    // The pup has moved either way; only remembering the spot can fail.
    drag.start(pet, o, (position) => void store.update({ position }).catch(reportError))
  })
  on('pet:drag-end', 'pet', () => drag.stop())
  on('pet:context-menu', 'pet', () => {
    if (pet && !pet.isDestroyed()) buildMenu(aggregator.state(), menuActions).popup({ window: pet })
  })

  // ── Lifecycle ────────────────────────────────────────────────────────────
  app.on('second-instance', openSettings)
  // The tray keeps the app alive when the settings window closes.
  app.on('window-all-closed', () => {})
  app.on('before-quit', () => {
    drag.stop()
    plan.stop()
    logs.stop()
    api.stop()
    live.stop()
  })

  void app.whenReady().then(() => {
    pet = createPetWindow(store.data.scale, store.data.position)
    pet.webContents.on('did-finish-load', () => pet?.webContents.send('state', aggregator.state()))
    pet.on('closed', () => {
      pet = null
    })

    tray = createTray(aggregator.state())
    tray.on('click', togglePet)
    tray.on('right-click', () => tray?.popUpContextMenu(buildMenu(aggregator.state(), menuActions)))

    live.start()
    plan.start()
    logs.start()
    api.start()
    aggregator.update()
    // Countdowns and staleness are time-based, so refresh even when no data changes.
    setInterval(() => aggregator.update(), 30_000)

    if (store.data.startOnLogin) setStartOnLogin(true)
    // First run: save defaults and open settings so the user can connect a data source.
    if (store.firstRun) {
      store.update({}).catch(reportError)
      openSettings()
    }
  })
}
