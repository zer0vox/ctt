// One character per palette entry. '.' is transparent. Sprites are written with these characters.
// The dog is a black-and-tan German Shepherd; light comes from the top left.
export const PALETTE: ReadonlyArray<{ ch: string; rgb: string }> = [
  { ch: '.', rgb: '' },
  { ch: 'o', rgb: '#1b1210' }, // outline (added automatically)
  // Saddle: the black coat on the back, ear rims, forehead stripe and muzzle mask.
  { ch: 'x', rgb: '#241b18' }, // black, deep shade
  { ch: 'a', rgb: '#3b2f2a' }, // black
  { ch: 'A', rgb: '#5d4c43' }, // black, sheen
  // Tan points: face, chest, legs.
  { ch: 'S', rgb: '#7a4320' }, // tan, deep shade
  { ch: 's', rgb: '#a6612e' }, // tan, shade
  { ch: 't', rgb: '#cd8843' }, // tan
  { ch: 'T', rgb: '#e7aa63' }, // tan, highlight
  { ch: 'L', rgb: '#f5d29a' }, // light tan: brows, bib, ear fur
  { ch: 'w', rgb: '#fff2db' }, // cream
  { ch: 'q', rgb: '#d4928a' }, // inner ear
  { ch: 'Q', rgb: '#9c5953' }, // inner ear, shade
  // Face.
  { ch: 'k', rgb: '#120a08' }, // ink: pupils, nose, mouth
  { ch: 'i', rgb: '#7b4a26' }, // iris
  { ch: 'e', rgb: '#ffffff' }, // eye shine
  { ch: 'n', rgb: '#776a64' }, // nose sheen
  { ch: 'p', rgb: '#f07a8c' }, // tongue
  { ch: 'P', rgb: '#c44c64' }, // tongue shade
  { ch: 'M', rgb: '#5a1c29' }, // inside of the mouth
  { ch: 'c', rgb: '#f08c84' }, // blush
  // Collar and tag.
  { ch: 'R', rgb: '#e8605a' }, // collar highlight
  { ch: 'r', rgb: '#c2343b' }, // collar
  { ch: 'j', rgb: '#85202a' }, // collar shade
  { ch: 'y', rgb: '#ffd54a' }, // gold: tag, sparkles, "?"
  { ch: 'Y', rgb: '#c8912a' }, // gold shade
  // Bowl and kibble.
  { ch: 'B', rgb: '#9fcaf5' }, // bowl highlight
  { ch: 'b', rgb: '#4f8fd6' }, // bowl
  { ch: 'd', rgb: '#2f5f9e' }, // bowl shade
  { ch: 'D', rgb: '#1f3f6c' }, // bowl, deep shade
  { ch: 'G', rgb: '#c99256' }, // kibble highlight
  { ch: 'g', rgb: '#8a5a2e' }, // kibble
  // Effects.
  { ch: 'H', rgb: '#ffa3b5' }, // heart highlight
  { ch: 'h', rgb: '#ff4d6d' }, // heart
  { ch: 'z', rgb: '#b5d8ff' }, // zzz
  { ch: 'Z', rgb: '#6f9fdc' }, // zzz shade
  { ch: 'u', rgb: '#8fd0ff' }, // sweat, tears
  { ch: 'U', rgb: '#e6f6ff' } // sweat shine
]

export const TRANSPARENT = 0
export const OUTLINE = 1

const INDEX = new Map(PALETTE.map((p, i) => [p.ch, i]))

export function colorIndex(ch: string): number {
  const i = INDEX.get(ch)
  if (i === undefined) throw new Error(`Unknown palette character "${ch}"`)
  return i
}

/**
 * Colour for an outline drawn over another part: a darker shade of what's underneath, so lines
 * inside the dog (chin over chest, leg over haunch) stay soft while the silhouette stays crisp.
 */
const INNER_LINE: Record<string, string> = {
  A: 'x',
  a: 'x',
  T: 's',
  t: 'S',
  s: 'S',
  L: 's',
  w: 'L',
  q: 'Q',
  R: 'j',
  r: 'j'
}

/** Palette index of the outline drawn over palette index `under` (TRANSPARENT: the plain outline). */
export const LINE_OVER: ReadonlyArray<number> = PALETTE.map(({ ch }) => (ch in INNER_LINE ? colorIndex(INNER_LINE[ch]) : OUTLINE))

/** Palette as [r, g, b] bytes, for bitmap output. */
export const PALETTE_RGB: ReadonlyArray<[number, number, number]> = PALETTE.map(({ rgb }) =>
  rgb ? [parseInt(rgb.slice(1, 3), 16), parseInt(rgb.slice(3, 5), 16), parseInt(rgb.slice(5, 7), 16)] : [0, 0, 0]
)
