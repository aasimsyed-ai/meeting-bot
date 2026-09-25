import type { ArgsOf, Channel, IpcErrorPayload, Results } from '../shared/ipc';
import type { AppEvent } from '../shared/types';

interface Bridge {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  onEvent(listener: (event: unknown) => void): () => void;
  platform: string;
}

declare global {
  interface Window {
    bridge: Bridge;
  }
}

/** A failed request, with a message that is safe to show as is. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}

export async function call<C extends Channel>(channel: C, ...args: ArgsOf<C>): Promise<Results[C]> {
  const res = await window.bridge.invoke(channel, ...(args as unknown[]));
  if (res && typeof res === 'object' && (res as IpcErrorPayload).__ipcError) {
    const e = res as IpcErrorPayload;
    throw new ApiError(e.message, e.code);
  }
  return res as Results[C];
}

export function onAppEvent(listener: (e: AppEvent) => void): () => void {
  return window.bridge.onEvent((e) => listener(e as AppEvent));
}

export const platform = (): string => window.bridge?.platform ?? 'unknown';
