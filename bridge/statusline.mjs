#!/usr/bin/env node
// Keeps only usage numbers from the input, never writes paths or prompts.

import { execSync } from 'node:child_process'
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = dirname(fileURLToPath(import.meta.url))
const STATE_FILE = join(dir, 'plan-state.json')
const CONFIG_FILE = join(dir, 'bridge.json')

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

function pickWindow(w) {
  if (!w || typeof w.used_percentage !== 'number') return undefined
  return { used_percentage: w.used_percentage, resets_at: typeof w.resets_at === 'number' ? w.resets_at : null }
}

let raw = ''
try {
  raw = readFileSync(0, 'utf8')
} catch {
  // No stdin, still print a line.
}
let input = {}
try {
  input = JSON.parse(raw) ?? {}
} catch {
  input = {}
}

const prev = readJson(STATE_FILE) ?? {}
const limits = input.rate_limits ?? {}
const fiveHour = pickWindow(limits.five_hour)
const sevenDay = pickWindow(limits.seven_day)
const now = Date.now()

// A window can be absent early in a session or after a reset, so keep the last.
const state = {
  updatedAt: now,
  rateLimitsSeenAt: fiveHour || sevenDay ? now : (prev.rateLimitsSeenAt ?? null),
  five_hour: fiveHour ?? prev.five_hour ?? null,
  seven_day: sevenDay ?? prev.seven_day ?? null,
  session_cost_usd: typeof input.cost?.total_cost_usd === 'number' ? input.cost.total_cost_usd : null,
  context_used_percentage:
    typeof input.context_window?.used_percentage === 'number' ? input.context_window.used_percentage : null,
  model: input.model?.display_name ?? input.model?.id ?? null
}

const tmp = `${STATE_FILE}.${process.pid}.tmp`
try {
  writeFileSync(tmp, JSON.stringify(state))
  try {
    renameSync(tmp, STATE_FILE)
  } catch {
    // Windows can refuse the rename while the widget has the file open.
    writeFileSync(STATE_FILE, JSON.stringify(state))
  }
} catch {
  // A failed write must not break the status line.
}

function pct(w) {
  if (!w) return '–'
  if (w.resets_at && w.resets_at * 1000 <= now) return '0%'
  return `${Math.round(w.used_percentage)}%`
}

// Prefer the output of a status line command that was installed before this one.
let line = null
const chain = readJson(CONFIG_FILE)?.chain?.command
if (typeof chain === 'string' && chain.trim()) {
  try {
    line = execSync(chain, { input: raw, encoding: 'utf8', timeout: 5000, windowsHide: true })
  } catch {
    line = null
  }
}
// process.exit right after a write can truncate piped output.
process.stdout.write(line ?? `5h ${pct(state.five_hour)} · 7d ${pct(state.seven_day)}`)
process.exitCode = 0
