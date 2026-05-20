---
name: opencode-aider-usage-estimation
---
need usage data for opencode and aider.
if they don't output token usage, we should estimate like cursor.
aider might be handled? spec drafter should confirm

## Refine turn 1

### Current state

Both agents currently return `usage_source: "unavailable"` / `cost_source: "no-usage"` with no token data. Neither outputs parseable usage in its stdout/stderr in a reliable way.

- `src/agents/opencode.ts`: `OPENCODE_HAS_PRICED_MODELS = false`, `resolveOpencodePriceKey` always returns `null`.
- `src/agents/aider.ts`: `AIDER_HAS_PRICED_MODELS = false`, `resolveAiderPriceKey` always returns `null`. Aider can print cost lines to stdout (e.g., `> Tokens: N sent, N received. Cost: $X message`) but the format is model-dependent and unreliable for extraction.

### Aider — drafter's answer

Aider is **not** currently handled. The stdout parsing path is fragile and not the right approach. The correct strategy is tiktoken estimation (same as cursor), mirroring `cursor-tokens.ts`. However, since aider's primary use in jarvis is local LLMs (Ollama, llama.cpp, etc.), `resolveAiderPriceKey` should remain returning `null` — token counts will be recorded as `usage_source: "estimated"` but cost will be `cost_source: "no-price"`. This gives volume visibility without implying fake billing. No prices.json entries are needed for aider.

### Opencode — what to implement

Opencode routes to named provider/model strings like `github-copilot/claude-opus-4.7`. These strings are already used as price keys in `data/prices.json` (one entry exists: `github-copilot/claude-opus-4.7`). The correct approach:

1. Implement tiktoken estimation (prompt + stdout) in opencode's `run()`.
2. Set `usage_source: "estimated"`, `OPENCODE_HAS_PRICED_MODELS = true`.
3. Update `resolveOpencodePriceKey` to return the model string as an identity key (same pattern as cursor's `CURSOR_KNOWN_MODELS` set, but simpler: just return `model` directly since opencode model strings ARE the price-table keys).
4. `cost_source` will be `"estimated"` when a price entry exists, `"no-price"` otherwise.
5. No new prices.json entries required — operators add them via `jarvis prices edit`.

### Shared token estimation

`cursor-tokens.ts` contains exactly the right logic (`estimateCursorUsage` with `cl100k_base` encoder, null fallback). To avoid duplicating it:

- Extract the function into `src/agents/token-estimation.ts` under a generic name (e.g., `estimateTokenUsage`).
- Have `cursor-tokens.ts` re-export it (preserving its existing public API).
- `opencode.ts` and `aider.ts` import from `token-estimation.ts`.

### Scope boundary

- No aider price-key mapping (local model use case has no billing).
- No native stdout parsing for either agent.
- No new prices.json entries in the spec — that's operator config.
- Telemetry enrichment, cost computation, and run-summary pipelines require no changes; they already handle `"estimated"` sources correctly.
- `telemetry-enrichment.ts` already handles the `estimated` cost-source path for mixed runs.

## Refine turn 2

### Drafting shape

This should draft as a small multi-file spec, not one large catch-all task. The natural split is:

1. shared estimator extraction (`src/agents/token-estimation.ts` plus cursor compatibility re-export),
2. opencode estimation plus price-key resolution,
3. aider estimation plus explicit no-price behavior,
4. documentation/tests covering the new estimated-usage behavior.

That keeps each slice independently reviewable and avoids mixing helper refactors with two agent integrations in one subspec.

### Acceptance-level constraints

- Preserve cursor's public helper surface: existing imports of `estimateCursorUsage` should keep working after extraction.
- Estimation must remain best-effort only. Any encoder init/encode failure must leave the run successful and fall back to today's `usage_source: "unavailable"` / `cost_source: "no-usage"` behavior with one warning on the agent result.
- For opencode, the returned price key should be the configured model string unchanged. If the operator has no matching row in `data/prices.json`, telemetry should still record estimated token counts and land on `cost_source: "no-price"`.
- For aider, successful runs with an estimate should produce `usage_source: "estimated"` and `cost_source: "no-price"` by construction, not `no-usage`.

### Test/doc focus

The draft should require unit coverage for the shared estimator helper and for both agent success/fallback branches. The important assertions are:

- helper returns prompt/stdout token counts and zero cache fields,
- helper failure returns `null`,
- opencode success attaches estimated usage and lets downstream pricing resolve from the model string,
- aider success attaches estimated usage without introducing a price key,
- estimator failure on either agent preserves the current unavailable/no-usage fallback with a warning.

Documentation updates should be limited to the agent/pricing docs that currently describe opencode and aider as having no usage data, plus any operator-facing note that opencode pricing depends on configured model strings already present in the price table.

## Refine turn 3

### Remaining drafting constraint

Opencode still has a patch-run-specific fallback notice in `src/modes/patch/run.ts` and matching prose in `docs/run-loop.md` that assumes every successful opencode run ends with `usage_source: "unavailable"` / `cost_source: "no-usage"`. The draft should explicitly require that this notice be removed or narrowed so it only appears on real estimator failure, not on normal successful opencode runs after this change.

### Warning/notice behavior

- Keep estimator failure warnings agent-local on the returned `AgentResult`, matching cursor's current pattern.
- Do not introduce a new one-time run-loop notice for aider success. Aider's normal success path after this change should simply record `usage_source: "estimated"` and `cost_source: "no-price"`.
- If opencode estimation succeeds, the old "token usage not available for this CLI version" message must no longer print for that run.

### Drafting detail

The doc slice should name the exact operator-facing files that now need wording changes:

- `docs/agents.md` agent table/setup text for opencode and aider,
- `docs/run-loop.md` telemetry/source descriptions and the opencode-specific notice text.

`docs/config.md` does not appear to describe usage accounting behavior and should not need to be part of this spec unless the drafter finds a concrete stale statement during file review.
