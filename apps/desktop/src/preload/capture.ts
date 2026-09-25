import { contextBridge, ipcRenderer } from 'electron';
import type { CaptureChannelName, CaptureWindowEvent } from '../shared/channels';

// Inlined on purpose: sandboxed preloads cannot load shared chunks.
// test/preload.test.ts checks these match CAPTURE_CHANNELS.
const AUDIO = 'capture-window:audio';
const EVENT = 'capture-window:event';

/** The hidden capture window can only send audio frames and capture events. */
contextBridge.exposeInMainWorld('captureBridge', {
  audio(channel: CaptureChannelName, buffer: ArrayBuffer) {
    ipcRenderer.send(AUDIO, channel, buffer);
  },
  event(evt: CaptureWindowEvent) {
    ipcRenderer.send(EVENT, evt);
  },
});
