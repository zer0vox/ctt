// Estimated USD per million tokens (checked 2026-10). Edit here if prices change.

interface Rate {
  input: number
  output: number
  cacheRead: number
}

// Most specific prefix first.
const RATES: Array<[prefix: string, rate: Rate]> = [
  ['claude-fable-5-1', { input: 10, output: 50, cacheRead: 0.25 }],
  ['claude-mythos-5-1', { input: 10, output: 50, cacheRead: 0.25 }],
  ['claude-fable-5', { input: 10, output: 50, cacheRead: 1 }],
  ['claude-mythos-5', { input: 10, output: 50, cacheRead: 1 }],
  ['claude-opus-5-5', { input: 4, output: 20, cacheRead: 0.2 }],
  ['claude-opus-5', { input: 5, output: 25, cacheRead: 0.5 }],
  ['claude-opus-4-8', { input: 5, output: 25, cacheRead: 0.5 }],
  ['claude-opus-4-7', { input: 5, output: 25, cacheRead: 0.5 }],
  ['claude-opus-4-6', { input: 5, output: 25, cacheRead: 0.5 }],
  ['claude-opus-4-5', { input: 5, output: 25, cacheRead: 0.5 }],
  ['claude-opus-4', { input: 15, output: 75, cacheRead: 1.5 }],
  ['claude-sonnet-5', { input: 2, output: 10, cacheRead: 0.2 }],
  ['claude-sonnet-4', { input: 3, output: 15, cacheRead: 0.3 }],
  ['claude-3-7-sonnet', { input: 3, output: 15, cacheRead: 0.3 }],
  ['claude-haiku-5-5', { input: 0.1, output: 0.5, cacheRead: 0.01 }],
  ['claude-haiku-4-5', { input: 1, output: 5, cacheRead: 0.1 }],
  ['claude-3-5-haiku', { input: 0.8, output: 4, cacheRead: 0.08 }]
]

const FAMILY: Array<[word: string, rate: Rate]> = [
  ['fable', { input: 10, output: 50, cacheRead: 0.25 }],
  ['mythos', { input: 10, output: 50, cacheRead: 0.25 }],
  ['opus', { input: 4, output: 20, cacheRead: 0.2 }],
  ['sonnet', { input: 2, output: 10, cacheRead: 0.2 }],
  ['haiku', { input: 0.1, output: 0.5, cacheRead: 0.01 }]
]

// Top-tier rates, so an unknown model errs towards overspend rather than $0.
const UNKNOWN: Rate = { input: 10, output: 50, cacheRead: 1 }

export function rateFor(model: string): Rate | null {
  const id = model.toLowerCase().replace(/\[.*\]$/, '')
  for (const [prefix, rate] of RATES) if (id.startsWith(prefix)) return rate
  for (const [word, rate] of FAMILY) if (id.includes(word)) return rate
  return null
}

export function isPriced(model: string): boolean {
  return rateFor(model) !== null
}

export interface TokenCounts {
  input: number
  output: number
  cacheWrite5m: number
  cacheWrite1h: number
  cacheRead: number
}

export function estimateCostUsd(model: string, t: TokenCounts, fast = false): number {
  const rate = rateFor(model) ?? UNKNOWN
  const usd =
    (t.input * rate.input +
      t.output * rate.output +
      t.cacheWrite5m * rate.input * 1.25 +
      t.cacheWrite1h * rate.input * 2 +
      t.cacheRead * rate.cacheRead) /
    1e6
  return fast ? usd * 2 : usd
}
