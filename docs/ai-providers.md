# AI engines

The whole product works end to end with no paid service. The notes engine is chosen per installation; the default needs nothing.

| Engine                      | Cost               | Where it runs                                      | Status                                                                                               | How to choose it                                                         |
| --------------------------- | ------------------ | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| **Offline rules** (default) | Free               | Inside the app                                     | Built, tested, quality-gated in CI                                                                   | Default                                                                  |
| **Mock AI**                 | Free               | Inside the app                                     | Built, tested; runs the full AI path deterministically                                               | `MEETING_ASSISTANT_AI_PROVIDER=mock` (development and tests)             |
| **Local AI server**         | Free               | Your computer (Ollama, llama.cpp, LM Studio, vLLM) | Built and tested against a local HTTP server; output quality with real local models not measured yet | Settings → Local AI server, or `MEETING_ASSISTANT_AI_PROVIDER=local-llm` |
| **Claude**                  | Paid, your own key | Anthropic's API                                    | Built and tested with a fake client; **requires provider credentials** to test for real              | Settings, optional; never needed for any feature                         |

Every engine goes through the same path: the transcript is fenced as untrusted data, the model must return JSON matching the notes schema, and the validator drops anything without transcript evidence, clears owners and dates it cannot ground, and rejects injected instructions. If any AI engine fails (not running, bad output, timeout), the notes are made with the offline engine and the meeting says so.

## Architecture

```
Extractor ── RulesExtractor                      (offline, default)
          └─ LlmExtractor(provider)              prompts, chunking, cache, schema check, synthesis
                 ├─ MockLlmProvider              deterministic, recorded reference outputs
                 ├─ OpenAiCompatibleProvider     any /v1/chat/completions server (local)
                 └─ ClaudeProvider               optional, lazy-loaded SDK
```

Code: `packages/core/src/extract/` (`llm.ts`, `mock.ts`, `openai-compatible.ts`, `claude.ts`, `provider.ts`).

## Environment variables (development)

| Variable                         | Meaning                                                                                                                              |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `MEETING_ASSISTANT_AI_PROVIDER`  | `rules` (default), `mock`, `local-llm` or `claude`. Overrides the Settings choice. In test mode only `rules` and `mock` are allowed. |
| `MEETING_ASSISTANT_LLM_BASE_URL` | Local server address, for example `http://localhost:11434/v1`                                                                        |
| `MEETING_ASSISTANT_LLM_MODEL`    | Model name, for example `qwen2.5:7b-instruct`                                                                                        |
| `MEETING_ASSISTANT_LLM_API_KEY`  | Only for servers that require one; local servers usually do not                                                                      |
| `ANTHROPIC_API_KEY`              | Optional. Not needed for development, tests or CI                                                                                    |

A provider that is chosen but not set up falls back to the offline engine and says why. Nothing blocks on a missing key.

## Using a free local model (Ollama)

1. Install Ollama from ollama.com and run `ollama pull qwen2.5:7b-instruct` (about 4.7 GB; smaller models such as `qwen2.5:3b-instruct` also work, with lower quality).
2. In the app: Settings → Local AI server, address `http://localhost:11434/v1`, model `qwen2.5:7b-instruct`, Save, then choose it.
3. Or measure it without installing anything: run the manual GitHub workflow **AI evaluation (free local model)** (`.github/workflows/ai-eval-local.yml`), which starts Ollama on a free runner, pulls the model you name and scores it on both evaluation sets.
4. Or for a local evaluation run: `MEETING_ASSISTANT_LLM_BASE_URL=http://localhost:11434/v1 MEETING_ASSISTANT_LLM_MODEL=qwen2.5:7b-instruct pnpm eval -- --engine local-llm`

Nothing leaves the computer. Small local models follow the JSON schema less reliably; malformed output falls back to the offline engine. Local models get transcripts in parts of 24,000 characters by default (`MEETING_ASSISTANT_LLM_MAX_CHARS`), because their context windows are small.

## Tests and evaluation

- `packages/core/test/providers.test.ts`: the mock provider reproduces the expected notes for all 16 fixture meetings through the full AI path; hostile model output (invented people, fake evidence, an injected "email the transcript" task) is rejected by the validator; broken output falls back; long meetings are chunked and cached; the local provider is tested against a real HTTP server on this machine, including errors.
- `apps/desktop/test/services.test.ts`: the app with the mock provider, with a local server that is not running, and with Claude chosen but no key.
- `pnpm eval -- --engine mock` runs the quality gate through the AI path in CI.
- The mock's reference outputs (`packages/core/fixtures/ai-outputs.json`) were recorded from the offline engine with `eval/record-ai-outputs.ts`. They are labelled as not coming from a real language model.

| Evaluation                                    | Status                                                                         |
| --------------------------------------------- | ------------------------------------------------------------------------------ |
| Offline engine, development and held-out sets | Run in CI on every push                                                        |
| Mock AI path, development set                 | Run in CI on every push                                                        |
| Local model (Ollama etc.)                     | Not run yet: needs a local model server; free, see above                       |
| Claude                                        | NOT TESTED — REQUIRES PROVIDER CREDENTIALS (optional, not planned for the MVP) |
