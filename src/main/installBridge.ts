// Installs the status line bridge into Claude Code's user settings, and removes it again.
// Plain Node (no Electron imports) so it can be tested against temp files.

import { execFile } from 'node:child_process'
import { copyFile, readFile } from 'node:fs/promises'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { BridgeStatus } from '../shared/types.ts'
import { writeFileAtomic } from './fsAtomic.ts'

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

/** bridge.json: the status line that was there before Token Pup, restored on uninstall. */
interface BridgeConfig {
  chain: StatusLine | null
}

function parseSettings(file: string, text: string): Record<string, unknown> {
  if (!text.trim()) return {}
  // Refuse to touch a settings file we can't parse rather than overwrite it.
  const parsed = JSON.parse(text)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(`${file} is not a JSON object`)
  return parsed
}

async function readSettings(file: string): Promise<Record<string, unknown>> {
  if (!existsSync(file)) return {}
  return parseSettings(file, await readFile(file, 'utf8'))
}

async function readConfig(paths: BridgePaths): Promise<BridgeConfig | null> {
  try {
    const parsed = JSON.parse(await readFile(join(paths.dataDir, CONFIG), 'utf8')) as Partial<BridgeConfig>
    const chain = parsed.chain
    return { chain: chain && typeof chain === 'object' && typeof chain.command === 'string' ? chain : null }
  } catch {
    return null
  }
}

const writeConfig = (paths: BridgePaths, config: BridgeConfig): Promise<void> =>
  writeFileAtomic(join(paths.dataDir, CONFIG), JSON.stringify(config, null, 2))

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
    const file = paths.claudeSettings
    statusLine = existsSync(file)
      ? (parseSettings(file, readFileSync(file, 'utf8')).statusLine as StatusLine)
      : undefined
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
 * The version of `node` on PATH, or null. The bridge runs as `node statusline.mjs`, but Claude
 * Code's native installer doesn't need Node, so it may not be there.
 */
export function nodeVersion(): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('node', ['--version'], { timeout: 5000, windowsHide: true }, (err, out) =>
      resolve(err ? null : out.trim() || null)
    )
  })
}

/**
 * Copy the bridge script into the data folder and point Claude Code's statusLine at it.
 * The first install backs up settings.json and remembers the status line that was there (if
 * any) so uninstalling restores it; reinstalling keeps both, so they always describe the
 * settings from before Token Pup.
 */
export async function installBridge(paths: BridgePaths, scriptSource: string): Promise<void> {
  const settings = await readSettings(paths.claudeSettings)
  await writeFileAtomic(join(paths.dataDir, SCRIPT), scriptSource)

  const existing = settings.statusLine as StatusLine | undefined
  if (!isOurs(existing)) await writeConfig(paths, { chain: existing ?? null })
  else if (!(await readConfig(paths))) await writeConfig(paths, { chain: null })

  const backup = `${paths.claudeSettings}.token-pup.bak`
  if (existsSync(paths.claudeSettings) && !existsSync(backup)) await copyFile(paths.claudeSettings, backup)

  settings.statusLine = { type: 'command', command: bridgeCommand(paths), padding: 0 }
  await writeFileAtomic(paths.claudeSettings, JSON.stringify(settings, null, 2) + '\n')
}

/** Remove our statusLine and restore the one that was there before, if any. */
export async function uninstallBridge(paths: BridgePaths): Promise<void> {
  const settings = await readSettings(paths.claudeSettings)
  if (!isOurs(settings.statusLine)) return
  const chained = (await readConfig(paths))?.chain ?? null
  if (chained) settings.statusLine = chained
  else delete settings.statusLine
  await writeFileAtomic(paths.claudeSettings, JSON.stringify(settings, null, 2) + '\n')
  await writeConfig(paths, { chain: null })
}
