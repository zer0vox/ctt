import { app, BrowserWindow, screen } from 'electron'
import { join } from 'node:path'
import { SCENE_H, SCENE_W } from '../shared/sprites/compose.ts'

/** Space above the dog for the hover card, and below it for the HUD bars. */
const CARD_H = 160
const HUD_H = 56
const MIN_W = 232

export function petSize(scale: number): { width: number; height: number } {
  return { width: Math.max(MIN_W, SCENE_W * scale + 16), height: CARD_H + SCENE_H * scale + HUD_H }
}

const preload = (): string => join(__dirname, '../preload/index.js')

function loadPage(win: BrowserWindow, page: 'index' | 'settings'): void {
  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (!app.isPackaged && devUrl) void win.loadURL(`${devUrl}/${page}.html`)
  else void win.loadFile(join(__dirname, `../renderer/${page}.html`))
}

type Point = { x: number; y: number }
type Size = { width: number; height: number }

/**
 * Keep the dog and its stats bar on the screen they're nearest to. Only the transparent space
 * above the dog (where the hover card appears) may hang off the top edge.
 */
export function clampPosition(pos: Point, size: Size): Point {
  const a = screen.getDisplayNearestPoint({
    x: Math.round(pos.x + size.width / 2),
    y: Math.round(pos.y + size.height - 1)
  }).workArea
  // `+ 0` turns -0 into 0: Math.round(-0.4) is -0, and Electron's setPosition rejects -0.
  return {
    x: Math.round(Math.min(Math.max(pos.x, a.x), a.x + a.width - size.width)) + 0,
    y: Math.round(Math.min(Math.max(pos.y, a.y - CARD_H), a.y + a.height - size.height)) + 0
  }
}

/** Bottom-right corner of the primary display, above the taskbar. */
export function defaultPosition(size: Size): Point {
  const a = screen.getPrimaryDisplay().workArea
  return { x: a.x + a.width - size.width - 24, y: a.y + a.height - size.height }
}

export function createPetWindow(scale: number, saved: Point | null): BrowserWindow {
  const size = petSize(scale)
  // A saved spot may be off screen now (e.g. a monitor was unplugged); pull it back.
  const pos = saved ? clampPosition(saved, size) : defaultPosition(size)
  const win = new BrowserWindow({
    ...pos,
    ...size,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    // Clicking the pet shouldn't take focus away from whatever you're working in.
    focusable: false,
    show: false,
    title: 'Token Pup',
    webPreferences: { preload: preload(), contextIsolation: true, nodeIntegration: false, sandbox: true }
  })
  win.setAlwaysOnTop(true, 'floating')
  // Transparent areas pass clicks through; the renderer turns this off while the cursor is over the dog.
  win.setIgnoreMouseEvents(true, { forward: true })
  win.once('ready-to-show', () => win.showInactive())
  loadPage(win, 'index')
  return win
}

/** Resize the pet, keeping its bottom-right corner where it was. */
export function resizePet(win: BrowserWindow, scale: number): void {
  const old = win.getBounds()
  const size = petSize(scale)
  const pos = clampPosition({ x: old.x + old.width - size.width, y: old.y + old.height - size.height }, size)
  win.setBounds({ ...pos, ...size })
}

export function createSettingsWindow(icon: Electron.NativeImage): BrowserWindow {
  const win = new BrowserWindow({
    width: 540,
    height: 820,
    minWidth: 420,
    minHeight: 480,
    title: 'Token Pup Settings',
    icon,
    autoHideMenuBar: true,
    show: false,
    backgroundColor: '#f4f1ec',
    webPreferences: { preload: preload(), contextIsolation: true, nodeIntegration: false, sandbox: true }
  })
  win.once('ready-to-show', () => win.show())
  loadPage(win, 'settings')
  return win
}

/** Moves the pet with the cursor while dragging (main-process polling stays smooth across DPI changes). */
export class PetDrag {
  private timer: NodeJS.Timeout | null = null
  private onEnd: (() => void) | null = null

  start(win: BrowserWindow, offset: Point, onEnd: (pos: Point) => void): void {
    this.stop()
    // The renderer starts the drag after a few pixels of movement; `offset` is that distance,
    // so the window catches up with the cursor instead of lagging behind it.
    const startCursor = screen.getCursorScreenPoint()
    const { x: wx, y: wy, width, height } = win.getBounds()
    this.onEnd = () => {
      if (win.isDestroyed()) return
      const [x, y] = win.getPosition()
      onEnd({ x, y })
    }
    this.timer = setInterval(() => {
      if (win.isDestroyed()) return this.stop()
      const c = screen.getCursorScreenPoint()
      const next = clampPosition(
        { x: wx + offset.x + c.x - startCursor.x, y: wy + offset.y + c.y - startCursor.y },
        { width, height }
      )
      win.setPosition(next.x, next.y)
    }, 16)
  }

  active(): boolean {
    return this.timer !== null
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    const end = this.onEnd
    this.onEnd = null
    end?.()
  }
}
