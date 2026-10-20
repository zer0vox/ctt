import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { PetState, PupApi } from '../shared/types.ts'

const api: PupApi = {
  getState: () => ipcRenderer.invoke('state:get'),
  onState: (cb) => {
    const listener = (_e: IpcRendererEvent, state: PetState): void => cb(state)
    ipcRenderer.on('state', listener)
    return () => ipcRenderer.removeListener('state', listener)
  },
  onSettingsChanged: (cb) => {
    const listener = (): void => cb()
    ipcRenderer.on('settings-changed', listener)
    return () => ipcRenderer.removeListener('settings-changed', listener)
  },
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (patch) => ipcRenderer.invoke('settings:save', patch),
  setApiKey: (key) => ipcRenderer.invoke('apikey:set', key),
  installBridge: () => ipcRenderer.invoke('bridge:install'),
  uninstallBridge: () => ipcRenderer.invoke('bridge:uninstall'),
  previewJoy: (joy) => ipcRenderer.send('preview:joy', joy),
  setIgnoreMouse: (ignore) => ipcRenderer.send('pet:ignore-mouse', ignore),
  dragStart: (offset) => ipcRenderer.send('pet:drag-start', offset),
  dragEnd: () => ipcRenderer.send('pet:drag-end'),
  showContextMenu: () => ipcRenderer.send('pet:context-menu')
}

contextBridge.exposeInMainWorld('pup', api)
