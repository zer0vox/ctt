import type { PupApi } from '../shared/types.ts'

declare global {
  interface Window {
    pup: PupApi
  }
}

export {}
