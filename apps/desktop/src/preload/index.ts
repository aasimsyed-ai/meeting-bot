import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { APP_CHANNELS } from '../shared/channels';

/**
 * The only bridge between the UI and the app. The UI can call named
 * operations (validated in the main process) and listen for events.
 * No Node.js or Electron APIs are exposed.
 */
const api = {
  invoke(channel: string, ...args: unknown[]): Promise<unknown> {
    return ipcRenderer.invoke(APP_CHANNELS.invoke, channel, args);
  },
  onEvent(listener: (event: unknown) => void): () => void {
    const wrapped = (_e: IpcRendererEvent, payload: unknown) => listener(payload);
    ipcRenderer.on(APP_CHANNELS.event, wrapped);
    return () => ipcRenderer.removeListener(APP_CHANNELS.event, wrapped);
  },
  platform: process.platform,
};

contextBridge.exposeInMainWorld('bridge', api);
