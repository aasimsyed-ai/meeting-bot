/** Errors carry a plain-language message the UI can show as is. */

export type AiErrorCode =
  | 'not_configured'
  | 'auth'
  | 'rate_limit'
  | 'offline'
  | 'timeout'
  | 'server'
  | 'refused'
  | 'truncated'
  | 'malformed'
  | 'bad_request'
  | 'cancelled'
  | 'unknown';

const MESSAGES: Record<AiErrorCode, string> = {
  not_configured: 'Cloud AI is not set up, so notes were made on this device.',
  auth: 'Cloud AI could not sign in. Check the Claude key in Settings.',
  rate_limit: 'Cloud AI is busy right now. The meeting will be analyzed again shortly.',
  offline:
    'You appear to be offline. The meeting was saved and will be analyzed when you are back online.',
  timeout: 'Cloud AI took too long to respond.',
  server: 'Cloud AI had a temporary problem.',
  refused: 'Cloud AI declined to analyze this meeting.',
  truncated: 'The meeting was too long for a single analysis.',
  malformed: 'Cloud AI returned notes in an unexpected format.',
  bad_request: 'Cloud AI could not process this request.',
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
    this.retryable = ['rate_limit', 'offline', 'timeout', 'server'].includes(code);
  }
}
