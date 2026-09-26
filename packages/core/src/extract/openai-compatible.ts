import { z } from 'zod';
import { AiError } from '../errors.ts';
import type { LlmProvider, LlmRequest } from './llm.ts';
import { RawExtractionSchema } from './schema.ts';

/**
 * Any server that speaks the OpenAI chat completions API: free local servers such
 * as Ollama (http://localhost:11434/v1), llama.cpp's llama-server, LM Studio or
 * vLLM. No account or key is needed for local servers. Output is requested as
 * JSON matching the notes schema and is still checked and validated like any
 * other untrusted model output.
 */

export interface OpenAiCompatibleOptions {
  /** For example http://localhost:11434/v1 */
  baseUrl: string;
  model: string;
  /** Only for servers that require one. Local servers usually do not. */
  apiKey?: string;
  timeoutMs?: number;
  /** Injected in tests. */
  fetch?: typeof fetch;
}

const NOTES_JSON_SCHEMA = z.toJSONSchema(RawExtractionSchema);

export class OpenAiCompatibleProvider implements LlmProvider {
  readonly kind = 'local-llm' as const;
  readonly model: string;

  private readonly opts: OpenAiCompatibleOptions;

  constructor(opts: OpenAiCompatibleOptions) {
    this.opts = opts;
    this.model = opts.model;
  }

  async generate({ system, user, signal }: LlmRequest): Promise<unknown> {
    const doFetch = this.opts.fetch ?? fetch;
    const url = `${this.opts.baseUrl.replace(/\/+$/, '')}/chat/completions`;
    const timeout = AbortSignal.timeout(this.opts.timeoutMs ?? 300_000);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let res: Response;
    try {
      res = await doFetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(this.opts.apiKey ? { authorization: `Bearer ${this.opts.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: this.model,
          temperature: 0,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          response_format: {
            type: 'json_schema',
            json_schema: { name: 'meeting_notes', strict: true, schema: NOTES_JSON_SCHEMA },
          },
        }),
        signal: combined,
      });
    } catch (err) {
      if (signal?.aborted) throw new AiError('cancelled', undefined, { cause: err });
      if (timeout.aborted) throw new AiError('timeout', undefined, { cause: err });
      throw new AiError('unreachable', url, { cause: err });
    }
    if (!res.ok) throw httpError(res.status, await res.text().catch(() => ''));

    const body = (await res.json().catch(() => null)) as {
      choices?: {
        finish_reason?: string;
        message?: { content?: string | null; refusal?: string };
      }[];
    } | null;
    const choice = body?.choices?.[0];
    if (!choice?.message) throw new AiError('malformed', 'No message in the response.');
    if (choice.message.refusal) throw new AiError('refused');
    if (choice.finish_reason === 'length') throw new AiError('truncated');
    const text = stripCodeFence(choice.message.content ?? '');
    try {
      return JSON.parse(text);
    } catch (err) {
      throw new AiError('malformed', 'The model did not return valid JSON.', { cause: err });
    }
  }
}

function httpError(status: number, detail: string): AiError {
  if (status === 401 || status === 403) return new AiError('auth');
  if (status === 404) return new AiError('bad_request', 'Model or endpoint not found.');
  if (status === 429) return new AiError('rate_limit');
  if (status >= 500) return new AiError('server');
  return new AiError('bad_request', detail.slice(0, 200));
}

/** Some local models wrap JSON in ```json fences despite the schema. */
function stripCodeFence(text: string): string {
  const m = /^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/i.exec(text);
  return (m ? m[1]! : text).trim();
}
