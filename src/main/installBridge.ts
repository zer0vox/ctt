// Installs the status line bridge into Claude Code's user settings, and removes it again.
// Plain Node (no Electron imports) so it can be tested against temp files.

import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { BridgeStatus } from '../shared/types.ts'

export interface BridgePaths {
  /** ~/.claude/settings.json */
  claudeSettings: string
  /** Folder the bridge script, its config and plan-state.json live in. */
  dataDir: string
}

const SCRIPT = 'statusline.mjs'
const CONFIG = 'bridge.json'
export const STATE_FILE = 'plan-state.json'

interface StatusLine {
  type: string
  command: string
  padding?: number
  [key: string]: unknown
}

function readSettings(file: string): Record<string, unknown> {
  if (!existsSync(file)) return {}
  const text = readFileSync(file, 'utf8')
  if (!text.trim()) return {}
  // Refuse to touch a settings file we can't parse rather than overwrite it.
  const parsed = JSON.parse(text)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(`${file} is not a JSON object`)
  return parsed
}

function writeAtomic(file: string, text: string): void {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.token-pup.tmp`
  writeFileSync(tmp, text)
  renameSync(tmp, file)
}

export function bridgeCommand(paths: BridgePaths): string {
  return `node "${join(paths.dataDir, SCRIPT).replaceAll('\\', '/')}"`
}

function isOurs(statusLine: unknown): boolean {
  const cmd = (statusLine as StatusLine | undefined)?.command
  return typeof cmd === 'string' && cmd.includes('token-pup') && cmd.includes(SCRIPT)
}

export function bridgeStatus(paths: BridgePaths): BridgeStatus {
  let statusLine: StatusLine | undefined
  try {
    statusLine = readSettings(paths.claudeSettings).statusLine as StatusLine | undefined
  } catch {
    statusLine = undefined
  }
  const stateFile = join(paths.dataDir, STATE_FILE)
  return {
    installed: isOurs(statusLine) && existsSync(join(paths.dataDir, SCRIPT)),
    otherCommand: statusLine && !isOurs(statusLine) ? String(statusLine.command ?? '') : null,
    lastUpdate: existsSync(stateFile) ? statSync(stateFile).mtimeMs : null
  }
}

/**
 * Copy the bridge script into the data folder and point Claude Code's statusLine at it.
 * Backs up settings.json first. An existing status line command is kept and chained, so the
 * user still sees their own status line.
 */
export function installBridge(paths: BridgePaths, scriptSource: string): void {
  const settings = readSettings(paths.claudeSettings)
  mkdirSync(paths.dataDir, { recursive: true })
  writeFileSync(join(paths.dataDir, SCRIPT), scriptSource)

  const existing = settings.statusLine as StatusLine | undefined
  if (existing && !isOurs(existing)) {
    writeFileSync(join(paths.dataDir, CONFIG), JSON.stringify({ chain: existing }, null, 2))
  }
  if (existsSync(paths.claudeSettings)) copyFileSync(paths.claudeSettings, `${paths.claudeSettings}.token-pup.bak`)

  settings.statusLine = { type: 'command', command: bridgeCommand(paths), padding: 0 }
  writeAtomic(paths.claudeSettings, JSON.stringify(settings, null, 2) + '\n')
}

/** Remove our statusLine and restore the one that was there before, if any. */
export function uninstallBridge(paths: BridgePaths): void {
  const settings = readSettings(paths.claudeSettings)
  if (!isOurs(settings.statusLine)) return
  const configFile = join(paths.dataDir, CONFIG)
  let chained: StatusLine | undefined
  try {
    chained = JSON.parse(readFileSync(configFile, 'utf8')).chain
  } catch {
    chained = undefined
  }
  if (chained) settings.statusLine = chained
  else delete settings.statusLine
  writeAtomic(paths.claudeSettings, JSON.stringify(settings, null, 2) + '\n')
  if (existsSync(configFile)) writeFileSync(configFile, JSON.stringify({}, null, 2))
}
