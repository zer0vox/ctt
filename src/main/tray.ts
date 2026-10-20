import { Menu, nativeImage, Tray, type MenuItemConstructorOptions, type NativeImage } from 'electron'
import { headline } from '../shared/headline.ts'
import { frameFor } from '../shared/sprites/animate.ts'
import { composeScene, PORTRAITS, sceneToBitmap } from '../shared/sprites/compose.ts'
import { PALETTE_RGB } from '../shared/sprites/palette.ts'
import type { MoodId, PetState } from '../shared/types.ts'

const iconCache = new Map<string, NativeImage>()

export function moodIcon(mood: MoodId, scale = 1): NativeImage {
  const key = `${mood}@${scale}`
  const cached = iconCache.get(key)
  if (cached) return cached
  // A frame with no blink, minus the floating overlays.
  const spec = frameFor(mood, 5, 1)
  spec.overlays = []
  spec.dy = 0
  const bmp = sceneToBitmap(composeScene(spec), PALETTE_RGB, scale, PORTRAITS[spec.pose], true)
  const img = nativeImage.createFromBitmap(Buffer.from(bmp.data), { width: bmp.width, height: bmp.height })
  iconCache.set(key, img)
  return img
}

export interface MenuActions {
  petVisible: () => boolean
  togglePet: () => void
  clickThrough: () => boolean
  toggleClickThrough: () => void
  startOnLogin: () => boolean
  toggleStartOnLogin: (() => void) | null
  openSettings: () => void
  quit: () => void
}

export function buildMenu(state: PetState, a: MenuActions): Menu {
  const items: MenuItemConstructorOptions[] = [
    { label: headline(state), enabled: false },
    { type: 'separator' },
    { label: a.petVisible() ? 'Hide pup' : 'Show pup', click: a.togglePet },
    { label: 'Click-through', type: 'checkbox', checked: a.clickThrough(), click: a.toggleClickThrough },
    {
      label: a.toggleStartOnLogin ? 'Start on login' : 'Start on login (installed app only)',
      type: 'checkbox',
      checked: a.startOnLogin(),
      enabled: !!a.toggleStartOnLogin,
      click: () => a.toggleStartOnLogin?.()
    },
    { type: 'separator' },
    { label: 'Settings…', click: a.openSettings },
    { label: 'Quit Token Pup', click: a.quit }
  ]
  return Menu.buildFromTemplate(items)
}

export function createTray(state: PetState): Tray {
  const tray = new Tray(moodIcon(state.mood))
  tray.setToolTip('Token Pup')
  return tray
}

export function tooltip(state: PetState): string {
  const lines = [`Token Pup — ${headline(state)}`]
  for (const s of state.snapshots) lines.push(`${s.label}: ${s.summary}${s.stale ? ' (stale)' : ''}`)
  // Windows truncates tray tooltips at 127 characters.
  return lines.join('\n').slice(0, 127)
}
