import { IPC_SCHEMAS, type Channel } from '../shared/ipc';
import type { log as Log } from './log';

type Handlers = Record<string, (...args: unknown[]) => unknown>;

/**
 * The single IPC entry point: only trusted senders, only known channels, only
 * arguments that pass their schema, and errors reduced to safe messages.
 */
export function createIpcHandler<S>(deps: {
  isTrusted: (sender: S) => boolean;
  handlers: Handlers;
  log: Pick<typeof Log, 'warn' | 'error'>;
  userMessage: (err: unknown) => { message: string; code: string };
}) {
  return async (sender: S, channel: unknown, args: unknown): Promise<unknown> => {
    // Only our own main window may call the API.
    if (!deps.isTrusted(sender))
      return { __ipcError: true, message: 'Not allowed.', code: 'forbidden' };
    if (typeof channel !== 'string' || !(channel in IPC_SCHEMAS))
      return { __ipcError: true, message: 'Unknown request.', code: 'invalid' };
    const parsed = IPC_SCHEMAS[channel as Channel].safeParse(args);
    if (!parsed.success) {
      deps.log.warn('ipc_invalid_args', { channel });
      return { __ipcError: true, message: 'That request was not valid.', code: 'invalid' };
    }
    try {
      return await deps.handlers[channel]!(...(parsed.data as unknown[]));
    } catch (err) {
      deps.log.error('ipc_failed', { channel, error: err instanceof Error ? err : String(err) });
      return { __ipcError: true, ...deps.userMessage(err) };
    }
  };
}
