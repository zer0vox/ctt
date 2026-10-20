import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

// Windows returns these while antivirus or the indexer holds the file open.
const TRANSIENT = new Set(['EPERM', 'EBUSY', 'EACCES'])
const RETRIES = 4

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** Falls back to a non-atomic in-place write if the target stays locked. */
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
        await writeFile(file, data)
        return
      }
    }
  } finally {
    await rm(tmp, { force: true }).catch(() => {})
  }
}
