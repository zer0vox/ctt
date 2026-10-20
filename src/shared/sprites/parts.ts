// Positions are in the 48x56 dog cell; face parts are relative to the head origin.

export type Grid = readonly string[]

export function mirror(grid: Grid): string[] {
  return grid.map((row) => [...row].reverse().join(''))
}

/** `rightMap` recolours the mirrored half so highlights stay on the left. */
export function sym(left: Grid, rightMap: Record<string, string> = {}): string[] {
  return left.map((row) => {
    const right = [...row].reverse().map((ch) => rightMap[ch] ?? ch).join('')
    return row + right
  })
}

const LIGHT_LEFT = { T: 't' }

// Head origin is the top-left of the 48-wide head band.
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

// Paired parts are drawn for the on-screen left and mirrored for the right.
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

export const EYES = {
  open: { grid: ['.kk.', 'kekk', 'kiik', '.kk.'], x: 16, y: 7 },
  half: { grid: ['kkkk', 'kiik', '.kk.'], x: 16, y: 8 },
  closed: { grid: ['k..k', '.kk.'], x: 16, y: 9 },
  happy: { grid: ['.kk.', 'k..k'], x: 16, y: 8 },
  sad: { grid: ['..kk', '.kek', 'kiek', '.kk.'], x: 16, y: 7 }
} satisfies Record<string, Sprite>
export type EyeKind = keyof typeof EYES

// 't' paints over the resting brow pip.
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
  pant2: { grid: ['.kkkkkk.', 'kMMMMMMk', 'kMppppMk', '.kpppPk.', '..pPPP..', '...PP...'], x: 20, y: 14 },
  frown: { grid: ['...kk...', '..kkkk..', '.k....k.'], x: 20, y: 14 },
  sleep: { grid: ['...kk...', '..k..k..'], x: 20, y: 14 },
  sniff: { grid: ['...kk...', '...kk...'], x: 20, y: 14 },
  lick: { grid: ['......pp', 'k..kk.pP', '.kk..kk.'], x: 20, y: 13 }
} satisfies Record<string, Sprite>
export type MouthKind = keyof typeof MOUTHS

export const BLUSH: Sprite = { grid: ['cc'], x: 13, y: 11 }

// Bodies are side-on, so not mirrored.
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

export const TAILS = {
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

// Props and overlays use scene coordinates.
export const BOWL: Grid = [
  'BBBBBBBBBBBBBb',
  'bbbbbbbbbbbbbd',
  '.bbbbbbbbbbbd.',
  '.ddbbbbbbbbdd.',
  '..ddddddddDD..',
  '...DDDDDDDD...'
]

/** Rows above the rim, bottom row first. */
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
