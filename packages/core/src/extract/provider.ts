import { ClaudeExtractor } from './claude.ts';
import { LlmExtractor, type ExtractionCache } from './llm.ts';
import { MockLlmProvider, type RecordedOutput } from './mock.ts';
import { OpenAiCompatibleProvider } from './openai-compatible.ts';
import { RulesExtractor } from './rules.ts';
import type { Extractor } from './schema.ts';

/**
 * Chooses the notes engine. The default is the offline rules engine: free, local
 * and always available. Nothing here requires a paid service; a provider that is
 * selected but not configured falls back to the offline engine and says why.
 *
 *   MEETING_ASSISTANT_AI_PROVIDER   rules (default) | mock | local-llm | claude
 *   MEETING_ASSISTANT_LLM_BASE_URL  local-llm: e.g. http://localhost:11434/v1 (Ollama)
 *   MEETING_ASSISTANT_LLM_MODEL     local-llm: e.g. qwen2.5:7b-instruct
 *   MEETING_ASSISTANT_LLM_API_KEY   local-llm: only if the server requires one
 *   MEETING_ASSISTANT_LLM_MAX_CHARS local-llm: transcript characters per request (default 24000)
 *   ANTHROPIC_API_KEY               claude: optional, the user's own key
 */

export type AiProviderId = 'rules' | 'mock' | 'local-llm' | 'claude';

export interface AiProviderConfig {
  provider: AiProviderId;
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  /** Characters per request before a long meeting is split. Local models have small contexts. */
  maxChunkChars?: number;
  claudeApiKey?: string;
}

export const AI_PROVIDERS: readonly AiProviderId[] = ['rules', 'mock', 'local-llm', 'claude'];

export function aiConfigFromEnv(env: Record<string, string | undefined>): AiProviderConfig {
  const requested = (env.MEETING_ASSISTANT_AI_PROVIDER ?? 'rules').trim().toLowerCase();
  const provider = (AI_PROVIDERS as readonly string[]).includes(requested)
    ? (requested as AiProviderId)
    : 'rules';
  return {
    provider,
    baseUrl: env.MEETING_ASSISTANT_LLM_BASE_URL || undefined,
    model: env.MEETING_ASSISTANT_LLM_MODEL || undefined,
    apiKey: env.MEETING_ASSISTANT_LLM_API_KEY || undefined,
    maxChunkChars: Number(env.MEETING_ASSISTANT_LLM_MAX_CHARS) || undefined,
    claudeApiKey: env.ANTHROPIC_API_KEY || undefined,
  };
}

export interface ProviderChoice {
  extractor: Extractor;
  /** Used when the chosen provider fails at run time. */
  fallback?: Extractor;
  /** Set when the requested provider could not be used, in plain words. */
  unavailable?: string;
}

export function createExtractor(
  cfg: AiProviderConfig,
  opts: { cache?: ExtractionCache; recorded?: readonly RecordedOutput[] } = {},
): ProviderChoice {
  const rules = new RulesExtractor();
  switch (cfg.provider) {
    case 'mock':
      return {
        extractor: new LlmExtractor(new MockLlmProvider({ recorded: opts.recorded }), {
          cache: opts.cache,
        }),
        fallback: rules,
      };
    case 'local-llm':
      if (!cfg.baseUrl || !cfg.model)
        return {
          extractor: rules,
          unavailable:
            'Local AI needs a server address and model name (for example Ollama at http://localhost:11434/v1). Notes were made with the offline engine.',
        };
      return {
        extractor: new LlmExtractor(
          new OpenAiCompatibleProvider({
            baseUrl: cfg.baseUrl,
            model: cfg.model,
            apiKey: cfg.apiKey,
          }),
          { cache: opts.cache, maxChunkChars: cfg.maxChunkChars ?? 24_000 },
        ),
        fallback: rules,
      };
    case 'claude':
      if (!cfg.claudeApiKey)
        return {
          extractor: rules,
          unavailable:
            'Claude needs your own API key (requires provider credentials). Notes were made with the offline engine.',
        };
      return {
        extractor: new ClaudeExtractor({ apiKey: cfg.claudeApiKey, cache: opts.cache }),
        fallback: rules,
      };
    default:
      return { extractor: rules };
  }
}
