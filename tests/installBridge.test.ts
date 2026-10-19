import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { bridgeStatus, installBridge, uninstallBridge, type BridgePaths } from '../src/main/installBridge.ts'

const SCRIPT = readFileSync(join(__dirname, '../bridge/statusline.mjs'), 'utf8')

let root: string
let paths: BridgePaths

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pup-bridge-'))
  mkdirSync(join(root, '.claude'))
  paths = { claudeSettings: join(root, '.claude', 'settings.json'), dataDir: join(root, 'token-pup') }
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

const readSettings = (): any => JSON.parse(readFileSync(paths.claudeSettings, 'utf8'))

function runBridge(input: unknown): string {
  // Run outside Electron's environment so `node` behaves like Claude Code's shell.
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  return execFileSync('node', [join(paths.dataDir, 'statusline.mjs')], { input: JSON.stringify(input), encoding: 'utf8', env })
}

describe('installBridge', () => {
  it('adds a statusLine, keeps other settings and backs up the file', () => {
    writeFileSync(paths.claudeSettings, JSON.stringify({ theme: 'dark', permissions: { allow: ['Read'] } }))
    installBridge(paths, SCRIPT)
    const s = readSettings()
    expect(s.theme).toBe('dark')
    expect(s.permissions.allow).toEqual(['Read'])
    expect(s.statusLine.type).toBe('command')
    expect(s.statusLine.command).toContain('token-pup/statusline.mjs')
    expect(existsSync(`${paths.claudeSettings}.token-pup.bak`)).toBe(true)
    expect(bridgeStatus(paths)).toMatchObject({ installed: true, otherCommand: null })
  })

  it('works when settings.json does not exist yet', () => {
    installBridge(paths, SCRIPT)
    expect(readSettings().statusLine.command).toContain('statusline.mjs')
  })

  it('refuses to overwrite a settings file it cannot parse', () => {
    writeFileSync(paths.claudeSettings, '{ not json')
    expect(() => installBridge(paths, SCRIPT)).toThrow()
    expect(readFileSync(paths.claudeSettings, 'utf8')).toBe('{ not json')
  })

  it('chains an existing status line and restores it on uninstall', () => {
    const theirs = { type: 'command', command: 'node -e "process.stdout.write(\'theirs\')"', padding: 1 }
    writeFileSync(paths.claudeSettings, JSON.stringify({ statusLine: theirs }))
    expect(bridgeStatus(paths).otherCommand).toBe(theirs.command)

    installBridge(paths, SCRIPT)
    expect(runBridge({ rate_limits: { five_hour: { used_percentage: 10, resets_at: 9999999999 } } })).toBe('theirs')

    uninstallBridge(paths)
    expect(readSettings().statusLine).toEqual(theirs)
    expect(bridgeStatus(paths).installed).toBe(false)
  })

  it('removes the statusLine entirely when there was none before', () => {
    writeFileSync(paths.claudeSettings, JSON.stringify({ theme: 'dark' }))
    installBridge(paths, SCRIPT)
    uninstallBridge(paths)
    expect(readSettings()).toEqual({ theme: 'dark' })
  })
})

describe('statusline bridge script', () => {
  it('writes only the numbers and prints a status line', () => {
    installBridge(paths, SCRIPT)
    const resets = Math.floor(Date.now() / 1000) + 3600
    const out = runBridge({
      session_id: 'abc',
      transcript_path: 'C:/Users/someone/secret/path.jsonl',
      workspace: { current_dir: 'C:/Users/someone/project' },
      model: { id: 'claude-opus-5-5', display_name: 'Opus 5.5' },
      cost: { total_cost_usd: 1.5 },
      context_window: { used_percentage: 12 },
      rate_limits: {
        five_hour: { used_percentage: 42.4, resets_at: resets },
        seven_day: { used_percentage: 18, resets_at: resets + 86400 }
      }
    })
    expect(out).toBe('🐶 5h 42% · 7d 18%')
    const raw = readFileSync(join(paths.dataDir, 'plan-state.json'), 'utf8')
    expect(raw).not.toContain('someone')
    expect(raw).not.toContain('abc')
    const state = JSON.parse(raw)
    expect(state.five_hour).toEqual({ used_percentage: 42.4, resets_at: resets })
    expect(state.session_cost_usd).toBe(1.5)
    expect(state.model).toBe('Opus 5.5')
  })

  it('keeps the last known limits when an update has none', () => {
    installBridge(paths, SCRIPT)
    runBridge({ rate_limits: { five_hour: { used_percentage: 50, resets_at: 9999999999 } } })
    runBridge({ model: { display_name: 'Opus' } })
    const state = JSON.parse(readFileSync(join(paths.dataDir, 'plan-state.json'), 'utf8'))
    expect(state.five_hour.used_percentage).toBe(50)
  })

  it('survives empty or invalid input', () => {
    installBridge(paths, SCRIPT)
    expect(runBridge('not an object')).toBe('🐶 5h – · 7d –')
  })
})
