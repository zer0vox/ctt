import { colorIndex, LINE_OVER, OUTLINE, TRANSPARENT } from './palette.ts'
import {
  BLUSH,
  BOWL,
  BROWS,
  EARS,
  EYES,
  HEAD,
  KIBBLE,
  mirror,
  MOUTHS,
  NOSE,
  OVERLAYS,
  POSES,
  TAILS,
  type BrowKind,
  type EarKind,
  type EyeKind,
  type Grid,
  type MouthKind,
  type OverlayKind,
  type Pose,
  type PoseKind,
  type Sprite,
  type TailKind
} from './parts.ts'

export const SCENE_W = 64
export const SCENE_H = 64
/** Paired parts mirror around the centre of the dog cell. */
export const CELL = 48
export const DOG_X = 2
export const DOG_Y = 8
const BOWL_X = 49
const BOWL_Y = 58

export interface Crop {
  x: number
  y: number
  w: number
  h: number
}

/** Head crops for icons. */
export const PORTRAITS: Record<PoseKind, Crop> = {
  sit: { x: DOG_X + 15, y: DOG_Y - 1, w: 32, h: 32 },
  lie: { x: DOG_X + 14, y: DOG_Y + 23, w: 32, h: 32 }
}

export interface FrameSpec {
  pose: PoseKind
  /** Left and right as seen on screen. */
  ears: [EarKind, EarKind]
  eyes: EyeKind
  brows: BrowKind | null
  eyeShift: number
  mouth: MouthKind
  tail: TailKind
  blush: boolean
  dy: number
  headDx: number
  headDy: number
  /** Kibble level, 0..1. */
  bowl: number
  overlays: Array<{ kind: OverlayKind; x: number; y: number }>
}

export type Scene = Uint8Array

/** Palette index per pixel, -1 where empty. */
type Layer = Int16Array

/** 'hard' outlines draw over what's underneath, 'soft' only fill transparent pixels. */
type OutlineMode = 'hard' | 'soft' | 'none'

function newLayer(): Layer {
  return new Int16Array(SCENE_W * SCENE_H).fill(-1)
}

function put(layer: Layer, grid: Grid, x: number, y: number): void {
  for (let r = 0; r < grid.length; r++) {
    const row = grid[r]
    const sy = y + r
    if (sy < 0 || sy >= SCENE_H) continue
    for (let c = 0; c < row.length; c++) {
      const ch = row[c]
      if (ch === '.') continue
      const sx = x + c
      if (sx < 0 || sx >= SCENE_W) continue
      layer[sy * SCENE_W + sx] = colorIndex(ch)
    }
  }
}

/** 'r' mirrors the left-side sprite across the dog cell. */
function putSide(layer: Layer, s: Sprite, side: 'l' | 'r', originX: number, y: number, shift = 0): void {
  if (side === 'l') return put(layer, s.grid, originX + s.x + shift, y + s.y)
  const w = Math.max(...s.grid.map((r) => r.length))
  put(layer, mirror(s.grid.map((r) => r.padEnd(w, '.'))), originX + CELL - s.x - w + shift, y + s.y)
}

function putPair(layer: Layer, s: Sprite, originX: number, y: number, shift = 0): void {
  putSide(layer, s, 'l', originX, y, shift)
  putSide(layer, s, 'r', originX, y, shift)
}

function commit(scene: Scene, layer: Layer, mode: OutlineMode): void {
  if (mode !== 'none') {
    for (let y = 0; y < SCENE_H; y++) {
      for (let x = 0; x < SCENE_W; x++) {
        const i = y * SCENE_W + x
        if (layer[i] >= 0) continue
        const edge =
          (x > 0 && layer[i - 1] >= 0) ||
          (x < SCENE_W - 1 && layer[i + 1] >= 0) ||
          (y > 0 && layer[i - SCENE_W] >= 0) ||
          (y < SCENE_H - 1 && layer[i + SCENE_W] >= 0)
        if (!edge) continue
        if (scene[i] === TRANSPARENT) scene[i] = OUTLINE
        else if (mode === 'hard') scene[i] = LINE_OVER[scene[i]]
      }
    }
  }
  for (let i = 0; i < layer.length; i++) if (layer[i] >= 0) scene[i] = layer[i]
}

function draw(scene: Scene, mode: OutlineMode, fill: (layer: Layer) => void): void {
  const layer = newLayer()
  fill(layer)
  commit(scene, layer, mode)
}

function putKibble(layer: Layer, fill: number): void {
  const total = KIBBLE.reduce((n, row) => n + [...row].filter((ch) => ch !== '.').length, 0)
  let left = Math.round(Math.min(1, Math.max(0, fill)) * total)
  for (let r = 0; r < KIBBLE.length && left > 0; r++) {
    const row = KIBBLE[r]
    // Centre outwards, so a partial row looks like a small mound.
    const cols = [...row].map((ch, c) => ({ ch, c })).filter((p) => p.ch !== '.')
    const mid = (row.length - 1) / 2
    cols.sort((a, b) => Math.abs(a.c - mid) - Math.abs(b.c - mid))
    for (const { ch, c } of cols) {
      if (left-- <= 0) break
      layer[(BOWL_Y - 1 - r) * SCENE_W + BOWL_X + c] = colorIndex(ch)
    }
  }
}

export function composeScene(spec: FrameSpec): Scene {
  const scene: Scene = new Uint8Array(SCENE_W * SCENE_H)
  const pose: Pose = POSES[spec.pose]
  const ox = DOG_X
  const oy = DOG_Y + spec.dy
  const hx = ox + pose.headX + spec.headDx
  const hy = oy + pose.headY + spec.headDy

  // Back to front, each part with its own outline so overlaps stay readable.
  const tail = TAILS[spec.tail]
  draw(scene, 'soft', (l) => put(l, tail.grid, ox + tail.x, oy + tail.y))
  draw(scene, 'soft', (l) => {
    putSide(l, EARS[spec.ears[0]], 'l', hx, hy)
    putSide(l, EARS[spec.ears[1]], 'r', hx, hy)
  })
  draw(scene, 'hard', (l) => put(l, pose.body, ox, oy + pose.bodyY))
  if (pose.collar) draw(scene, 'none', (l) => put(l, pose.collar!.grid, ox + pose.headX, oy + pose.collar!.y))
  draw(scene, 'hard', (l) => put(l, HEAD, hx, hy))

  draw(scene, 'none', (l) => {
    if (spec.brows) putPair(l, BROWS[spec.brows], hx, hy)
    putPair(l, EYES[spec.eyes], hx, hy, spec.eyeShift)
    if (spec.blush) putPair(l, BLUSH, hx, hy)
    put(l, NOSE.grid, hx + NOSE.x, hy + NOSE.y)
    const mouth = MOUTHS[spec.mouth]
    put(l, mouth.grid, hx + mouth.x, hy + mouth.y)
  })

  if (pose.paws) draw(scene, 'hard', (l) => put(l, pose.paws!.grid, ox + pose.headX, oy + pose.paws!.y))

  draw(scene, 'soft', (l) => put(l, BOWL, BOWL_X, BOWL_Y))
  draw(scene, 'soft', (l) => putKibble(l, spec.bowl))

  for (const o of spec.overlays) draw(scene, 'soft', (l) => put(l, OVERLAYS[o.kind], o.x, o.y))
  return scene
}

export function sceneToBitmap(
  scene: Scene,
  palette: ReadonlyArray<[number, number, number]>,
  scale: number,
  crop: Crop = { x: 0, y: 0, w: SCENE_W, h: SCENE_H },
  bgra = false
): { data: Uint8Array; width: number; height: number } {
  const width = crop.w * scale
  const height = crop.h * scale
  const data = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = scene[(crop.y + Math.floor(y / scale)) * SCENE_W + crop.x + Math.floor(x / scale)]
      if (idx === TRANSPARENT) continue
      const [r, g, b] = palette[idx]
      const o = (y * width + x) * 4
      data[o] = bgra ? b : r
      data[o + 1] = g
      data[o + 2] = bgra ? r : b
      data[o + 3] = 255
    }
  }
  return { data, width, height }
}
