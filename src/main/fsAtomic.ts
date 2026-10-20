// One way to save files from the main process: never blocks the event loop, never leaves a
// half-written file for readers, and never leaves its temp file behind.

import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/** Windows reports these while antivirus or the search indexer briefly holds a file open. */
const TRANSIENT = new Set(['EPERM', 'EBUSY', 'EACCES'])
const RETRIES = 4

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Write `file` through a temp file and a rename. While Windows holds the target locked, the
 * rename is retried with backoff; if it stays locked, the file is written in place instead.
 * Throws when even that fails (for example, a read-only file).
 */
export async function writeFileAtomic(file: string, data: string | Uint8Array): Promise<void> {
  await mkdir(dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  try {
    await writeFile(tmp, data)
    for (let attempt = 0; ; attempt++) {
      try {
        await rename(tmp, file)
        return
      } catch (e) {
        const code = (e as NodeJS.ErrnoException).code
        if (!code || !TRANSIENT.has(code)) throw e
        if (attempt < RETRIES) {
          await delay(25 * 2 ** attempt)
          continue
        }
        // Still locked: write in place (not atomic, but better than losing the change).
        await writeFile(file, data)
        return
      }
    }
  } finally {
    await rm(tmp, { force: true }).catch(() => {})
  }
}
