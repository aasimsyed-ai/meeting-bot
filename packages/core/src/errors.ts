/** Errors carry a plain-language message the UI can show as is. */

export type AiErrorCode =
  | 'not_configured'
  | 'auth'
  | 'rate_limit'
  | 'offline'
  | 'unreachable'
  | 'timeout'
  | 'server'
  | 'refused'
  | 'truncated'
  | 'malformed'
  | 'bad_request'
  | 'cancelled'
  | 'unknown';

const MESSAGES: Record<AiErrorCode, string> = {
  not_configured: 'The AI engine is not set up, so notes were made on this device.',
  auth: 'The AI service rejected the key. Check it in Settings.',
  rate_limit: 'The AI service is busy right now. The meeting will be analyzed again shortly.',
  offline:
    'You appear to be offline. The meeting was saved and will be analyzed when you are back online.',
  unreachable:
    'The local AI server could not be reached. Check that it is running (for example Ollama).',
  timeout: 'The AI engine took too long to respond.',
  server: 'The AI engine had a temporary problem.',
  refused: 'The AI engine declined to analyze this meeting.',
  truncated: 'The meeting was too long for a single analysis.',
  malformed: 'The AI engine returned notes in an unexpected format.',
  bad_request: 'The AI engine could not process this request.',
  cancelled: 'Analysis was cancelled.',
  unknown: 'Something went wrong while analyzing the meeting.',
};

export class AiError extends Error {
  readonly code: AiErrorCode;
  readonly retryable: boolean;
  readonly userMessage: string;

  constructor(code: AiErrorCode, detail?: string, options?: { cause?: unknown }) {
    super(detail ? `${MESSAGES[code]} (${detail})` : MESSAGES[code], options);
    this.name = 'AiError';
    this.code = code;
    this.userMessage = MESSAGES[code];
    this.retryable = ['rate_limit', 'offline', 'unreachable', 'timeout', 'server'].includes(code);
  }
}
