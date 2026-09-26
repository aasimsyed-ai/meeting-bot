import { AiError } from '../errors.ts';
import { LlmExtractor, type ExtractionCache, type LlmProvider, type LlmRequest } from './llm.ts';
import { RawExtractionSchema } from './schema.ts';

/**
 * Optional Claude provider. Nothing in the app requires it: it is used only when
 * someone chooses it and supplies their own API key. The SDK is loaded lazily,
 * so the package works without it installed.
 */

export { SYSTEM_PROMPT, buildMeetingBlock, buildUserContent, type ExtractionCache } from './llm.ts';

export const CLAUDE_PROMPT_VERSION = 'claude-2';
export const DEFAULT_CLAUDE_MODEL = 'claude-opus-5';

/** Minimal surface of the Anthropic client we use, so tests can inject a fake. */
export interface ClaudeClientLike {
  beta: {
    messages: {
      parse(
        params: Record<string, unknown>,
        options?: { signal?: AbortSignal; timeout?: number },
      ): PromiseLike<{ stop_reason: string | null; parsed_output?: unknown; model?: string }>;
    };
  };
}

export interface ClaudeExtractorOptions {
  /** Injected client (tests) or created from apiKey. */
  client?: ClaudeClientLike;
  apiKey?: string;
  model?: string;
  effort?: 'low' | 'medium' | 'high';
  /** Transcript characters per request before chunking. */
  maxChunkChars?: number;
  cache?: ExtractionCache;
  timeoutMs?: number;
}

export class ClaudeProvider implements LlmProvider {
  readonly kind = 'claude' as const;
  readonly model: string;
  private client: ClaudeClientLike | undefined;

  private readonly opts: ClaudeExtractorOptions;

  constructor(opts: ClaudeExtractorOptions = {}) {
    this.opts = opts;
    this.model = opts.model ?? DEFAULT_CLAUDE_MODEL;
    this.client = opts.client;
  }

  private async getClient(): Promise<ClaudeClientLike> {
    if (this.client) return this.client;
    if (!this.opts.apiKey) throw new AiError('not_configured');
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    this.client = new Anthropic({
      apiKey: this.opts.apiKey,
      maxRetries: 2,
    }) as unknown as ClaudeClientLike;
    return this.client;
  }

  async generate({ system, user, signal }: LlmRequest): Promise<unknown> {
    const client = await this.getClient();
    const { betaZodOutputFormat } = await import('@anthropic-ai/sdk/helpers/beta/zod');
    let res;
    try {
      res = await client.beta.messages.parse(
        {
          model: this.model,
          max_tokens: 16000,
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          thinking: { type: 'adaptive' },
          output_config: {
            effort: this.opts.effort ?? 'high',
            format: betaZodOutputFormat(RawExtractionSchema),
          },
          system,
          messages: [{ role: 'user', content: user }],
        },
        { signal, timeout: this.opts.timeoutMs ?? 180_000 },
      );
    } catch (err) {
      throw await toAiError(err, signal);
    }
    if (res.stop_reason === 'refusal') throw new AiError('refused');
    if (res.stop_reason === 'max_tokens') throw new AiError('truncated');
    return res.parsed_output;
  }
}

/** Claude through the shared LLM extraction path. */
export class ClaudeExtractor extends LlmExtractor {
  constructor(opts: ClaudeExtractorOptions = {}) {
    super(new ClaudeProvider(opts), {
      maxChunkChars: opts.maxChunkChars,
      cache: opts.cache,
      promptVersion: CLAUDE_PROMPT_VERSION,
    });
  }
}

async function toAiError(err: unknown, signal?: AbortSignal): Promise<AiError> {
  if (err instanceof AiError) return err;
  if (signal?.aborted) return new AiError('cancelled');
  let sdk: typeof import('@anthropic-ai/sdk').default | undefined;
  try {
    sdk = (await import('@anthropic-ai/sdk')).default;
  } catch {
    sdk = undefined;
  }
  if (sdk) {
    if (err instanceof sdk.AuthenticationError || err instanceof sdk.PermissionDeniedError)
      return new AiError('auth', undefined, { cause: err });
    if (err instanceof sdk.RateLimitError)
      return new AiError('rate_limit', undefined, { cause: err });
    if (err instanceof sdk.APIConnectionTimeoutError)
      return new AiError('timeout', undefined, { cause: err });
    if (err instanceof sdk.APIConnectionError)
      return new AiError('offline', undefined, { cause: err });
    if (err instanceof sdk.InternalServerError)
      return new AiError('server', undefined, { cause: err });
    if (err instanceof sdk.BadRequestError)
      return new AiError('bad_request', err.message, { cause: err });
    if (err instanceof sdk.APIUserAbortError)
      return new AiError('cancelled', undefined, { cause: err });
    if (err instanceof sdk.APIError && typeof err.status === 'number' && err.status >= 500)
      return new AiError('server', undefined, { cause: err });
  }
  if (err instanceof SyntaxError) return new AiError('malformed', err.message, { cause: err });
  return new AiError('unknown', err instanceof Error ? err.message : String(err), { cause: err });
}
