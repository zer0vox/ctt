// Hand-placed pixel grids for the German Shepherd. Symmetric parts are drawn as the left half
// and mirrored. Coordinates are in the 48x56 dog cell; head-relative parts are offset from the
// head origin.

export type Grid = readonly string[]

/** Reverse each row (left/right flip). */
export function mirror(grid: Grid): string[] {
  return grid.map((row) => [...row].reverse().join(''))
}

/**
 * Build a symmetric grid from its left half. `rightMap` recolours the mirrored half, so
 * highlights stay on the left (light comes from the top left).
 */
export function sym(left: Grid, rightMap: Record<string, string> = {}): string[] {
  return left.map((row) => {
    const right = [...row].reverse().map((ch) => rightMap[ch] ?? ch).join('')
    return row + right
  })
}

const LIGHT_LEFT = { T: 't' }

// ── Head (origin = top-left of the 48-wide head band) ──────────────────────
export const HEAD = sym(
  [
    '..................Tttaaa',
    '................TTtttaaa',
    '...............TTttttsaa',
    '..............Tttttttsaa',
    '.............Tttttttttsa',
    '.............tttttttttsa',
    '............sttttLLtttta',
    '............sttttttttsaa',
    '............stTttttttsaA',
    '...........ttTTtttttsaAa',
    '...........stTTttttsaAaa',
    '...........sttTtttsaaaaa',
    '............sttttsaaaaaa',
    '.............sttsaaaaaaa',
    '..............ssaaaaaaaa',
    '...............Ssaatttts',
    '.................Ssstttt'
  ],
  LIGHT_LEFT
)
export const HEAD_H = HEAD.length

export interface Sprite {
  grid: Grid
  x: number
  y: number
}

// Ears: the left ear (as seen on screen); the right one is its mirror image.
export const EARS = {
  up: {
    grid: [
      '..a......',
      '.aaa.....',
      '.aaa.....',
      '.aQqT....',
      'xAQqT....',
      'xAQqLT...',
      'xaQqqL...',
      'xaQqqLT..',
      'xaaQqwL..',
      'xaaQqLwT.',
      'xaaQQqLT.',
      '.aaaQqLwT',
      '.aaaQqLTt',
      '.aaaaQLTt',
      '..aaaatt.'
    ],
    x: 10,
    y: -11
  },
  // Pinned back and out ("airplane ears"): mostly the dark back of the ear shows.
  back: {
    grid: [
      'xa..........',
      'xaaa........',
      '.aAAaa......',
      '.aaAAaaa....',
      '..aaaaaaaa..',
      '..aaQqqaaaa.',
      '...aQqLTtaaa',
      '....aqLTtta.',
      '.....aatt...'
    ],
    x: 3,
    y: -2
  },
  // Flopped outwards, half-mast: sleepy.
  relaxed: {
    grid: [
      '.xa.........',
      'xaaa........',
      'xaAaa.......',
      '.aAQqa......',
      '.aaQqTa.....',
      '..aQqqLa....',
      '..aaQqLTa...',
      '...aaQqLTta.',
      '....aaqLTtta',
      '.....aaaLtt.',
      '.......aat..'
    ],
    x: 4,
    y: -6
  },
  // Cocked sideways, inner ear facing forward: curious.
  side: {
    grid: [
      'xa..........',
      'xaaa........',
      'xaQqaa......',
      '.aQqqLaa....',
      '.aaQqLwTaa..',
      '..aaQqLLTta.',
      '...aaaQLTtt.',
      '.....aaaaa..'
    ],
    x: 3,
    y: -3
  }
} satisfies Record<string, Sprite>
export type EarKind = keyof typeof EARS

// Eyes: left eye sprite; the right eye is mirrored. Positions are head-relative (left eye).
export const EYES = {
  open: { grid: ['.kk.', 'kekk', 'kiik', '.kk.'], x: 16, y: 7 },
  /** Lids half down: drowsy, and the in-between frame of a blink. */
  half: { grid: ['kkkk', 'kiik', '.kk.'], x: 16, y: 8 },
  closed: { grid: ['k..k', '.kk.'], x: 16, y: 9 },
  happy: { grid: ['.kk.', 'k..k'], x: 16, y: 8 },
  /** Looking up from under drooping lids, eyes wet. */
  sad: { grid: ['..kk', '.kek', 'kiek', '.kk.'], x: 16, y: 7 }
} satisfies Record<string, Sprite>
export type EyeKind = keyof typeof EYES

// Brows: the tan pips above the eyes move with the mood. 't' paints over the resting pip.
export const BROWS = {
  worried: { grid: ['.L', 'Lt'], x: 17, y: 5 },
  raised: { grid: ['LL', 'tt'], x: 17, y: 5 }
} satisfies Record<string, Sprite>
export type BrowKind = keyof typeof BROWS

export const NOSE: Sprite = { grid: ['.nkkk.', 'nkkkkk', '.kkkk.'], x: 21, y: 11 }

export const MOUTHS = {
  smile: { grid: ['...kk...', '.k....k.', '..kkkk..'], x: 20, y: 14 },
  pant: {
    grid: ['.kkkkkk.', 'kMMMMMMk', 'kMppppMk', '.kpppPk.', '..ppPP..', '..pPPP..', '...PP...'],
    x: 20,
    y: 14
  },
  /** Second panting frame: tongue drawn in a little. */
  pant2: { grid: ['.kkkkkk.', 'kMMMMMMk', 'kMppppMk', '.kpppPk.', '..pPPP..', '...PP...'], x: 20, y: 14 },
  frown: { grid: ['...kk...', '..kkkk..', '.k....k.'], x: 20, y: 14 },
  sleep: { grid: ['...kk...', '..k..k..'], x: 20, y: 14 },
  /** Nose working, mouth shut. */
  sniff: { grid: ['...kk...', '...kk...'], x: 20, y: 14 },
  /** A nervous lick of the nose. */
  lick: { grid: ['......pp', 'k..kk.pP', '.kk..kk.'], x: 20, y: 13 }
} satisfies Record<string, Sprite>
export type MouthKind = keyof typeof MOUTHS

export const BLUSH: Sprite = { grid: ['cc'], x: 13, y: 11 }

// ── Bodies (absolute dog-cell coordinates) ─────────────────────────────────
// Sitting in three-quarter view: body side-on facing the bowl, head turned to the viewer.
// Rows start at dog-cell row 20. Not mirrored: light still comes from the top left.
const SIT_BODY: Grid = [
  '.....................Aaaaax.....................',
  '....................Aaaaaaaax...................',
  '...................AaaaaaaaaaxT.................',
  '..................AaaaaaaaaaaaxTL...............',
  '.................AaaaaaaaaaaaaxTttTLL...........',
  '................AaaaaaaaaaaaaaxTttttTLL.........',
  '................AaaaaaaaaaaaaxTttttttTLL........',
  '...............AaaaaaaaaaaaaaxTtttttttTLL.......',
  '..............AaaaaaaaaaaaaaxTttttttttTLL.......',
  '.............AaaaaaaaaaaaaaxTttttttttttTLL......',
  '.............AaaaaaaaaaaaaxTtttttttttttTLL......',
  '............AaaaaaaaaaaaaxTttttttttttttTLL......',
  '...........AaaaaaaaaaaaaxTttttttttttttttTLL.....',
  '...........AaaaaaaaaaaaxTtttttttttttttttTLL.....',
  '..........AaaaaaaaaaaaxTtsSTttttttttttttTLL.....',
  '..........AaaaaaaaaaaxTttsSTttttttttttttTLL.....',
  '.........AaaaaaaaaaaxTttttsSTttttttttttTLL......',
  '.........AaaaaaaaaaxTtttttsSTttttttttttTLL......',
  '........AaaaaaaaaaxTtttttttsSTtttttttttTLL......',
  '........AaaaaaaaaxTtttttttttsSTttttttttTLL......',
  '.......AaaaaaaaaxTTTTTTsSsssssSTtttsSssssS......',
  '.......AaaaaaaaxTTttttttsSsssssTtttsSssssS......',
  '.......AaaaaaxTTtttttttttsSssssTtttsSssssS......',
  '......aaaaaxTTTtttttttttttsSSSSTtttsSssssS......',
  '......aaaaxTTTtttttttttttttsSSSTtttsSssssS......',
  '......aaaxTTtttttttttttttttsSSSTtttsSssssS......',
  '......aaxTTtttttttttttttttttsSSTtttsSssssS......',
  '......axTtttttttttttttttttttsSSTtttsSssssS......',
  '......sttttttttttttttttttttssSSTtttsSssssS......',
  '......stttttttttttttttttttssSSSTtttsSssssS......',
  '......stttttttttttttttsssssSSSSTtttsSssssS......',
  '......SsssssssssssssssssssSSSSSTtttsSssssS......',
  '......sssssssssssTTtttTLLLTsSSTLLTLTssTsTss.....',
  '......sssssssssssttttsTLsLTsSSTLsLsLsssSsSs.....',
  '......ssssssssssssssstTsTsTsSStTsTsTsSsSsSS.....',
  '.......SSSSSSSSSSssssssssssSSSsssssssSSSSSS.....'
]

const COLLAR = sym([
  '.............RRR........',
  '.............rrrRRR.....',
  '.............jjjrrrRRRRR',
  '................jjjrrrrr',
  '...................jjjYy',
  '......................Yy',
  '.......................Y'
])

// Lying in three-quarter view: body side-on behind the head, chin on the front paws.
// Rows start at dog-cell row 34.
const LIE_BODY: Grid = [
  '......................aaaaaaaaa.................',
  '..................Aaaaaaaaaaaaaaaa..............',
  '...............AAaaaaaaaaaaaaaaaaaaa............',
  '............AAaaaaaaaaaaaaaaaaaaaaaaaa..........',
  '..........AAaaaaaaaaaaaaaaaaaaaaaaaaaaaa........',
  '.........Aaaaaaaaaaaaaaaaaaaaaaaaaaaaaxtt.......',
  '........AaaaaaaaaaaaaaaaaaaaaaaaaxTTtttttt......',
  '.......AaaaaaaaaaaaaaaaaaaaxTTttttttttttttt.....',
  '......AaaaaaaaaaaaaaaxTTttttttttttttttttttt.....',
  '......aaaaaaaaaaxTTttttsttttttttttttttttttt.....',
  '.....aaaaaaaxTTttttttttSssssstttttttttttttt.....',
  '.....aaaaxTTtttttttttttSSSSSSssssssssssssss.....',
  '.....aaxTttttttttttttttSSSSSSssssssssssssss.....',
  '.....xTtttttttttttttttsSSSSSSssssssssssssss.....',
  '.....sttttttttttttttttsSSSSSSSSSSSSSSSSSSSS.....',
  '.....stttttttttttttttssSSSSSSSSSSSSSSSSSSSS.....',
  '.....stttttttttttttsssSSSSSSSSSSSSSSSSSSSSS.....',
  '.....ssttttttttttssssSSSSSSSSSSSSSSSSSSSSSS.....',
  '.....sssssssssTTtLLTsSSSSSSSSSSSSSSSSSSSSSS.....',
  '.....ssssssssstTsLsLsSSSSSSSSSSSSSSSSSSSSSS.....',
  '.....sssssssssssTsTsSSSSSSSSSSSSSSSSSSSSSSS.....',
  '......SSSSSSSSsssssssSSSSSSSSSSSSSSSSSSSSSS.....'
]

// Front legs stretched out towards the viewer; the chin rests on them.
const LIE_PAWS = sym([
  '................tTTTttsS',
  '...............tTTTTttsS',
  '...............tTTTtttsS',
  '...............TLLLTTtsS',
  '..............TLLLLLTtsS',
  '..............TLLLLLTtsS',
  '..............TLsLsLTssS',
  '..............tTsTsTtssS',
  '...............sssssssSS'
])

// Tail frames: drawn behind the body.
export const TAILS = {
  /** Hanging behind, the tip curled up. */
  rest: {
    grid: [
      '.aa.......',
      'aAaa......',
      'aAat......',
      'aaat......',
      'aaat......',
      'aaatt.....',
      'aaaat.....',
      'aaaatt....',
      'taaaat....',
      'taaaaat.aa',
      'ttaaaaaaaa',
      '.ttaaaaaaa',
      '.sttttaaa.',
      '..sssttt..',
      '....sss...'
    ],
    x: -1,
    y: 37
  },
  wagUp: {
    grid: [
      '..aa......',
      '.aAaa.....',
      '.aAaat....',
      '.aaaat....',
      '..aaaat...',
      '..aaaat...',
      '...aaaat..',
      '...aaaat..',
      '....aaaat.',
      '....aaaat.',
      '.....aaaat',
      '.....aaaat',
      '......aaat',
      '......aaaa',
      '.......aaa'
    ],
    x: -1,
    y: 31
  },
  wagMid: {
    grid: [
      'aa........',
      'aAaa......',
      'aAaaaat...',
      '.aaaaaatt.',
      '..taaaaaat',
      '...ttaaaaa',
      '.....ttaaa',
      '.......taa',
      '........aa'
    ],
    x: -1,
    y: 38
  },
  wagLow: {
    grid: [
      '........aa',
      'aa....aaaa',
      'aAaaaaaaaa',
      'aaaaaaaaa.',
      'taaaaaatt.',
      '.tttttts..',
      '..ssss....'
    ],
    x: -1,
    y: 44
  },
  /** Held low and close: worried. */
  low: {
    grid: [
      '.....aa',
      '..aaaaa',
      '.aaaaat',
      'aattttt',
      'ttsss..'
    ],
    x: 1,
    y: 48
  },
  /** Lying down: along the floor behind, the tip turned up. */
  flat: {
    grid: ['.aa......', 'aAaa.....', 'aaaat..aa', 'taaaaaaaa', 'ttaaaaaaa', '.tttttaa.', '..sssss..'],
    x: -1,
    y: 48
  }
} satisfies Record<string, Sprite>
export type TailKind = keyof typeof TAILS

export interface Pose {
  body: Grid
  bodyY: number
  /** Where the 48-wide head band sits in the dog cell. */
  headX: number
  headY: number
  collar?: { grid: Grid; y: number }
  paws?: { grid: Grid; y: number }
}

export const POSES = {
  sit: {
    body: SIT_BODY,
    bodyY: 20,
    headX: 7,
    headY: 11,
    collar: { grid: COLLAR, y: 27 }
  },
  lie: {
    body: LIE_BODY,
    bodyY: 34,
    headX: 7,
    headY: 30,
    paws: { grid: LIE_PAWS, y: 47 }
  }
} satisfies Record<string, Pose>
export type PoseKind = keyof typeof POSES

// ── Props and overlays (scene coordinates) ─────────────────────────────────
export const BOWL: Grid = [
  'BBBBBBBBBBBBBb',
  'bbbbbbbbbbbbbd',
  '.bbbbbbbbbbbd.',
  '.ddbbbbbbbbdd.',
  '..ddddddddDD..',
  '...DDDDDDDD...'
]

/** Kibble rows above the rim, bottom row first. Pixels fill from the bottom row up. */
export const KIBBLE: Grid = ['.gGgGgGgGgGgG.', '..gGgGgGgGgG..', '....gGgGgG....', '.....gGgG.....']

export const OVERLAYS = {
  heart: ['.hh.hh.', 'hHhhhhh', 'hHhhhhh', '.hhhhh.', '..hhh..', '...h...'],
  zzz: ['zzzzz', '...Z.', '..Z..', '.Z...', 'zzzzz'],
  zSmall: ['zzz', '.Z.', 'zzz'],
  sweat: ['.u.', 'uUu', 'uuu', '.u.'],
  tear: ['u', 'U', 'u'],
  question: ['.yyy.', 'yY.yy', '...yY', '..yY.', '..y..', '.....', '..y..'],
  sparkle: ['..y..', '..y..', 'yyYyy', '..y..', '..y..']
} satisfies Record<string, Grid>
export type OverlayKind = keyof typeof OVERLAYS
