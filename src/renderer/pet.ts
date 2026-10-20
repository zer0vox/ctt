import { fmtDuration, fmtPct } from '../shared/format.ts'
import { MOOD_LABELS } from '../shared/mood.ts'
import { FPS, frameFor, type Reaction } from '../shared/sprites/animate.ts'
import { composeScene, SCENE_H, SCENE_W, type Scene } from '../shared/sprites/compose.ts'
import { PALETTE, TRANSPARENT } from '../shared/sprites/palette.ts'
import type { PetState, UsageSnapshot } from '../shared/types.ts'

const pup = window.pup
const canvas = document.getElementById('scene') as HTMLCanvasElement
const ctx = canvas.getContext('2d')!
const hud = document.getElementById('hud')!
const card = document.getElementById('card')!

let state: PetState = { snapshots: [], primaryId: null, joy: null, mood: 'sniffing', celebrations: 0 }
// Null until the first state arrives, so opening the pet never celebrates.
let celebrated: number | null = null
let scale = 4
let px = 4
let tick = 0
let reaction: Reaction | null = null
let lastScene: Scene | null = null

function sizeCanvas(): void {
  const dpr = window.devicePixelRatio || 1
  // Whole device pixels per art pixel keep edges crisp at fractional Windows scaling.
  px = Math.max(1, Math.round(scale * dpr))
  canvas.width = SCENE_W * px
  canvas.height = SCENE_H * px
  canvas.style.width = `${(SCENE_W * px) / dpr}px`
  canvas.style.height = `${(SCENE_H * px) / dpr}px`
  document.body.style.setProperty('--scene-h', `${(SCENE_H * px) / dpr}px`)
}

function draw(): void {
  const bowl = state.joy ?? 0.5
  const scene = composeScene(frameFor(state.mood, tick, bowl, reaction))
  lastScene = scene
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  for (let y = 0; y < SCENE_H; y++) {
    for (let x = 0; x < SCENE_W; x++) {
      const idx = scene[y * SCENE_W + x]
      if (idx === TRANSPARENT) continue
      ctx.fillStyle = PALETTE[idx].rgb
      ctx.fillRect(x * px, y * px, px, px)
    }
  }
}

function barColor(left: number): string {
  if (left > 0.6) return 'var(--good)'
  if (left > 0.3) return 'var(--ok)'
  if (left > 0.1) return 'var(--low)'
  return 'var(--bad)'
}

function el(tag: string, cls: string, text = ''): HTMLElement {
  const e = document.createElement(tag)
  e.className = cls
  e.textContent = text
  return e
}

function hudRow(s: UsageSnapshot): HTMLElement {
  const row = el('div', 'row')
  row.classList.toggle('primary', s.id === state.primaryId)
  row.classList.toggle('stale', s.stale)
  row.title = s.details.join('\n')
  const left = 1 - (s.usedFraction ?? 0)
  const bar = el('div', 'bar')
  const fill = el('i', '')
  fill.style.width = `${left * 100}%`
  fill.style.background = barColor(left)
  bar.append(fill)
  row.append(el('span', 'label', s.short), bar, el('span', 'pct', `${fmtPct(left)} left`))
  return row
}

function renderHud(): void {
  hud.replaceChildren()
  if (state.mood === 'exhausted' && state.resetsAt) {
    hud.append(el('div', 'wake', `zzz… wakes in ${fmtDuration(state.resetsAt - Date.now())}`))
  }
  for (const s of state.snapshots) {
    if (s.usedFraction !== null) hud.append(hudRow(s))
    else hud.append(el('div', 'info', `${s.short.padEnd(4)}${s.summary}`))
  }
  if (!state.snapshots.length) hud.append(el('div', 'info', 'No data yet: right-click › Settings'))
  document.body.style.setProperty('--hud-h', `${hud.offsetHeight + 2}px`)
}

function renderCard(): void {
  const lines: HTMLElement[] = []
  const left = state.joy !== null ? ` · ${fmtPct(state.joy)} left` : ''
  const preview = state.primaryId === 'debug' ? ' (preview)' : ''
  lines.push(el('div', 'title', `${MOOD_LABELS[state.mood]}${left}${preview}`))
  for (const s of state.snapshots) {
    const reset = s.resetsAt ? ` · resets in ${fmtDuration(s.resetsAt - Date.now())}` : ''
    const line = el('div', 'line', `${s.label}: ${s.summary}${reset}`)
    if (s.stale) line.classList.add('muted')
    lines.push(line)
  }
  if (!state.snapshots.length) lines.push(el('div', 'line muted', 'Connect a data source in Settings.'))
  else if (state.joy === null) {
    lines.push(el('div', 'line muted', 'No limit to measure against yet.'))
    lines.push(el('div', 'line muted', 'Right-click › Settings: bridge or budget'))
  }
  lines.push(el('div', 'line muted', 'Click to pet · drag to move'))
  card.replaceChildren(...lines)
}

function onState(next: PetState): void {
  if (celebrated !== null && next.celebrations > celebrated) reaction = { kind: 'celebrate', startTick: tick }
  celebrated = next.celebrations
  state = next
  renderHud()
  if (card.classList.contains('show')) renderCard()
  draw()
}

let interactive = false
let pointerDown: { x: number; y: number } | null = null
let dragging = false

function setInteractive(on: boolean): void {
  if (on === interactive) return
  interactive = on
  pup.setIgnoreMouse(!on)
}

function overDog(clientX: number, clientY: number): boolean {
  if (!lastScene) return false
  const r = canvas.getBoundingClientRect()
  const x = Math.floor(((clientX - r.left) / r.width) * SCENE_W)
  const y = Math.floor(((clientY - r.top) / r.height) * SCENE_H)
  if (x < 0 || y < 0 || x >= SCENE_W || y >= SCENE_H) return false
  return lastScene[y * SCENE_W + x] !== TRANSPARENT
}

function showCard(show: boolean): void {
  if (show && !card.classList.contains('show')) renderCard()
  card.classList.toggle('show', show)
}

document.addEventListener('mousemove', (e) => {
  if (dragging) return
  const over = overDog(e.clientX, e.clientY) || hud.contains(e.target as Node)
  setInteractive(over)
  showCard(over)
})

document.addEventListener('mouseleave', () => {
  if (dragging) return
  setInteractive(false)
  showCard(false)
})

canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || !overDog(e.clientX, e.clientY)) return
  pointerDown = { x: e.screenX, y: e.screenY }
  canvas.setPointerCapture(e.pointerId)
})

canvas.addEventListener('pointermove', (e) => {
  if (!pointerDown || dragging) return
  const dx = e.screenX - pointerDown.x
  const dy = e.screenY - pointerDown.y
  if (Math.hypot(dx, dy) < 4) return
  dragging = true
  canvas.classList.add('dragging')
  showCard(false)
  pup.dragStart({ x: Math.round(dx), y: Math.round(dy) })
})

function endPointer(): void {
  if (dragging) pup.dragEnd()
  else if (pointerDown) reaction = { kind: 'petted', startTick: tick }
  pointerDown = null
  dragging = false
  canvas.classList.remove('dragging')
}
canvas.addEventListener('pointerup', endPointer)
canvas.addEventListener('pointercancel', endPointer)

document.addEventListener('contextmenu', (e) => {
  e.preventDefault()
  if (overDog(e.clientX, e.clientY) || hud.contains(e.target as Node)) pup.showContextMenu()
})

async function loadScale(): Promise<void> {
  scale = (await pup.getSettings()).settings.scale
  sizeCanvas()
  draw()
}

pup.onState(onState)
pup.onSettingsChanged(() => void loadScale())
// The resolution query only fires when leaving the ratio it names, so it is re-armed.
function watchPixelRatio(): void {
  window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`).addEventListener(
    'change',
    () => {
      sizeCanvas()
      draw()
      watchPixelRatio()
    },
    { once: true }
  )
}
watchPixelRatio()
window.addEventListener('resize', () => {
  sizeCanvas()
  draw()
})

void loadScale().then(async () => onState(await pup.getState()))
setInterval(() => {
  tick++
  draw()
}, 1000 / FPS)
// Keeps HUD countdowns current between state updates.
setInterval(renderHud, 30_000)
