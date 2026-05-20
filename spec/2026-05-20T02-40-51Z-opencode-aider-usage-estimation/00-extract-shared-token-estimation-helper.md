# 00 - Extract shared token estimation helper

## Problem

Cursor already has a best-effort tiktoken estimator in `src/agents/cursor-tokens.ts`, but opencode and aider need the same behavior. Duplicating that logic in each agent would make future estimator changes harder to test and reason about, and it would force later subspecs to mix shared-helper refactoring with agent-specific behavior changes.

## Decisions

- Extract the current `cl100k_base`-based estimator into a new shared module at `src/agents/token-estimation.ts`.
- Preserve the current cursor helper surface so existing imports of `estimateCursorUsage` continue to work after the extraction.
- Keep the estimator best-effort only: tokenizer init or encode failures return `null` rather than failing the run.
- The shared helper continues to estimate only prompt and stdout tokens and always reports zero cache token fields.
- This subspec does not change opencode or aider behavior yet; it only prepares the shared helper and cursor compatibility layer those later slices will consume.

## Task Checklist

- [ ] Create `src/agents/token-estimation.ts` with the shared encoder lifecycle and token estimation function.
- [ ] Update `src/agents/cursor-tokens.ts` to delegate to or re-export the shared helper without breaking the existing cursor-facing API.
- [ ] Add unit coverage for helper success and failure behavior.

## Documentation updates

- [ ] Update any inline code comments around `src/agents/cursor-tokens.ts` and the new shared helper so they describe the generic estimator rather than implying cursor-only ownership.

## Acceptance criteria

- [ ] `src/agents/token-estimation.ts` exports a shared helper that accepts `prompt` and `stdout` strings and returns `input_tokens`, `output_tokens`, `cache_read_input_tokens`, and `cache_creation_input_tokens`.
- [ ] On successful encoding, the helper returns prompt and stdout token counts with both cache fields set to `0`.
- [ ] If encoder initialization or tokenization throws, the helper returns `null` and does not turn the agent run into an error.
- [ ] Existing imports of `estimateCursorUsage` continue to compile and behave the same after the extraction.
- [ ] Unit tests cover both successful estimation and `null` fallback for tokenizer failure.
