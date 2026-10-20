import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ safeStorage: { isEncryptionAvailable: () => false } }))
const { SettingsStore } = await import('../src/main/settings.ts')

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pup-settings-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const writeConfig = (data: unknown): void => writeFileSync(join(dir, 'config.json'), JSON.stringify(data))
const readConfig = (): any => JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8'))

describe('pup size', () => {
  it('starts at Medium', () => {
    expect(new SettingsStore(dir).data.scale).toBe(3)
  })

  it('moves a size saved for the old 32px dog one step down, once', async () => {
    writeConfig({ scale: 4 })
    const store = new SettingsStore(dir)
    expect(store.data.scale).toBe(3)
    await store.update({ notifications: false })
    expect(readConfig()).toMatchObject({ scale: 3, sizeVersion: 2 })
    expect(new SettingsStore(dir).data.scale).toBe(3)
  })

  it('keeps sizes saved by this version and clamps to the menu', async () => {
    writeConfig({ scale: 5, sizeVersion: 2 })
    const store = new SettingsStore(dir)
    expect(store.data.scale).toBe(5)
    expect((await store.update({ scale: 9 })).scale).toBe(5)
    expect((await store.update({ scale: 1 })).scale).toBe(2)
  })
})
