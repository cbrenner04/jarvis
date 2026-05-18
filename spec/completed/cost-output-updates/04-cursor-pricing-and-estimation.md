# 04 - Cursor Pricing and Token Estimation

## Problem

Two interlocked gaps prevent Jarvis from reporting meaningful cursor cost:

1. `data/prices.json` only contains a `cursor-default` placeholder with null rates. The default cursor config uses model `"Composer 2"`, plus users can pick from a fixed menu of other cursor-exposed models. None have rates in `prices.json`, so even after subspec 03's price-key map there is nothing to multiply.
2. The cursor CLI does not return usage. `src/agents/cursor.ts` hard-codes `usage_source: "unavailable"` and `cost_source: "no-usage"` for every successful run, so cost would still be zero even with rates in place.

We want cursor rows in `prices.json` (rates filled manually per subspec 05) and a token-estimation path so cursor produces a useful, if approximate, cost.

## Decisions

### prices.json layout

- Remove the dead `cursor-default` row.
- Add one row per cursor-exposed model the user can pick via config or `--model`. Source list: <https://cursor.com/docs/models-and-pricing>. Use the exact model name cursor presents in its UI (`"Composer 2"`, `"Claude 4.7 Opus"`, `"GPT-5.5"`, etc.) as the price-key, so the per-agent map in subspec 03 can keep the cursor map as identity (the configured model name is the price key).
- Every new cursor row ships with `manual: true`, `manual_note: "Cursor pricing sourced from https://cursor.com/docs/models-and-pricing; reflects cursor's published per-token rate, not your invoice. Fill rates via 'jarvis prices edit'."`, and `as_of` set to the date the spec lands. Rates start `null`; the operator (cb) fills them via `jarvis prices edit` after merge.
- Cursor's published rates are billed against an "Auto + Composer pool" with included usage; the values in `prices.json` are the marginal per-token rates that cursor publishes, not your effective per-token rate after included credit. Document this in the row's `manual_note` and in `docs/run-loop.md`.

### Cursor model menu

- Co-locate the list of cursor-known models in `src/agents/cursor.ts` as a const (`CURSOR_KNOWN_MODELS`) so the per-agent price-key resolver from subspec 03 can validate configured models against it. The list is hand-maintained; cursor adds models rarely.
- The set to ship: `Composer 1`, `Composer 1.5`, `Composer 2`, `Claude 4 Sonnet`, `Claude 4.5 Haiku`, `Claude 4.5 Sonnet`, `Claude 4.5 Opus`, `Claude 4.6 Sonnet`, `Claude 4.6 Opus`, `Claude 4.7 Opus`, `GPT-5`, `GPT-5 Mini`, `GPT-5-Codex`, `GPT-5.1 Codex`, `GPT-5.1 Codex Max`, `GPT-5.1 Codex Mini`, `GPT-5.2`, `GPT-5.2 Codex`, `GPT-5.3 Codex`, `GPT-5.4`, `GPT-5.4 Mini`, `GPT-5.4 Nano`, `GPT-5.5`, `Gemini 2.5 Flash`, `Gemini 3 Flash`, `Gemini 3 Pro`, `Gemini 3.1 Pro`, `Grok 4.20`, `Grok 4.3`, `Kimi K2.5`. Any model not in this list passes config validation (unknown cursor models are not an error) but produces `no-price`.

### Cursor token estimation

- Add a tokenizer-based estimator. We do not get usage back from the CLI, so we estimate from what we control: the prompt we sent and the stdout we captured.
- Use `tiktoken` (well-supported in JS via `tiktoken` or `js-tiktoken`; pick the one with the smallest install footprint and no native build step). Encoder: `cl100k_base` — close enough for an estimate across providers, since the goal is order-of-magnitude usage, not invoice-grade precision.
- Estimator output: `input_tokens = encode(prompt).length`, `output_tokens = encode(stdout).length`, `cache_read_input_tokens = 0`, `cache_creation_input_tokens = 0`. No attempt to model cursor's internal cache.
- Introduce a new `usage_source` value `"estimated"` and a new `cost_source` value `"estimated"`. These are deliberately separate from `"agent"` and `"computed"` so the summary, telemetry consumers, and any future analysis can never confuse estimates with measurements.
- The cursor agent computes the estimate after the CLI exits successfully and returns `usage_source: "estimated"` with the token fields populated. `extractUsageAndCost` then runs cost computation via subspec 03's resolver and emits `cost_source: "estimated"` (overriding the `"computed"` it would otherwise have emitted, because the inputs were estimates).
- Run-summary rendering: cursor rows are labeled with `source estimated`. The summary footer adds a single note when estimated rows are present: `cursor cost is estimated from prompt + stdout token counts; actual cursor usage (tool calls, sub-turns) is not measurable from the CLI.`
- If tokenization fails for any reason (unexpected encoder error, prompt too large to encode), the agent falls back to today's behavior: `usage_source: "unavailable"`, no usage, `cost_source: "no-usage"`, plus one warning. Estimation is never allowed to crash the run.

### Risk surface (called out for review)

- **Undercount bias.** The prompt is what Jarvis sends; the real input to the model inside cursor includes cursor's system prompt, tool definitions, and prior turns. Multi-step cursor sessions may undercount tokens by several multiples. Acceptable for a clearly labeled estimate; not acceptable to call it `"computed"`.
- **Tokenizer mismatch.** `cl100k_base` is an OpenAI tokenizer; Claude and Gemini tokenize differently. Token counts will be in the right order of magnitude but not exact, especially for non-Latin scripts. Document in the new note.
- **Cost vs. invoice gap.** Cursor's published rates are reference rates against an "Auto + Composer pool." Reported cost is "what these tokens would cost at published rates," not "what cursor will bill you."
- **New telemetry source values.** `usage_source: "estimated"` and `cost_source: "estimated"` widen the union. Telemetry validators, mixed-cost-source detection, and downstream renderers must accept the new values explicitly; tests must cover the new source in `src/run-summary.ts` aggregation.

## Tasks

- [ ] Remove the `cursor-default` row from `data/prices.json`.
- [ ] Add cursor model rows (one per name in the menu above) with null rates and `manual: true`. Do not fill rates in code; that happens via `jarvis prices edit` post-merge.
- [ ] Add `CURSOR_KNOWN_MODELS` to `src/agents/cursor.ts` and expose `resolvePriceKey` as the identity over that set (returning `null` for anything outside it).
- [ ] Pick a tiktoken implementation and add it to `package.json`. Prefer the smallest dependency that works in Bun without native compile.
- [ ] Add `src/agents/cursor-tokens.ts` (or similarly scoped helper) exposing `estimateCursorUsage({ prompt, stdout }): TelemetryUsage`. Helper is responsible for encoder reuse and graceful failure.
- [ ] Update `src/agents/cursor.ts` to call the estimator on success and return `usage_source: "estimated"` with the populated token fields. On estimator failure, return today's `usage_source: "unavailable"` plus a single warning.
- [ ] Extend `UsageSource` and `CostSource` unions in `src/telemetry.ts` to include `"estimated"`.
- [ ] Update `extractUsageAndCost` to map a result with `usage_source: "estimated"` through subspec 03's price-key resolver and emit `cost_source: "estimated"` when a rate is found, `no-price` otherwise.
- [ ] Update `src/run-summary.ts` aggregation and notes:
  - Treat `"estimated"` as a meaningful cost-source bucket alongside `"agent"`, `"computed"`, `"no-price"`.
  - Add a footer note when any row's `cost_source` is `"estimated"`.
  - Update mixed-cost-source detection so `"estimated"` + `"computed"` for the same agent is not a "mixed source" complaint (cursor will frequently mix when models change between runs).
- [ ] Update the `cursor` agent's `attributionLabel` to use the configured model name verbatim (matches the price key under subspec 03).
- [ ] Tests:
  - Unit-test `estimateCursorUsage` with empty prompt, empty stdout, large prompt, and an encoder failure stubbed to verify graceful fallback.
  - Unit-test cursor agent integration: success path returns `"estimated"` source; estimator failure path returns `"unavailable"` plus warning.
  - Unit-test `extractUsageAndCost` with an `"estimated"` input and a priced cursor row → `cost_source: "estimated"` with a non-null cost.
  - Unit-test `extractUsageAndCost` with an `"estimated"` input and a no-rate cursor row → `cost_source: "no-price"`.
  - Run-summary tests covering the new footer note and the relaxed mixed-source rule.
- [ ] Update `docs/run-loop.md` (or the cost-tracking doc) with: cursor is estimated from prompt + stdout; estimate is clearly labeled; published rates are pre-credit; tokenizer is `cl100k_base` and imperfect for non-OpenAI models.

## Acceptance criteria

- [ ] `data/prices.json` contains one row per cursor-exposed model with `manual: true` and null rates; `cursor-default` is gone.
- [ ] A `jarvis run` configured with cursor + `Composer 2` (after the operator fills the row's rates via `jarvis prices edit`) produces a row with `source estimated` and a non-null cost computed from prompt + stdout token counts.
- [ ] A cursor run with rates still null produces a row with `source no-price`, not a crash and not silently `agent`/`computed`.
- [ ] The run summary includes a footer note explaining the estimate when any estimated row is present.
- [ ] Cursor token estimation failure (simulated encoder exception) does not fail the run; the affected iteration records `usage_source: "unavailable"` with a single warning.
- [ ] Telemetry record for an estimated cursor run carries `usage_source: "estimated"`, `cost_source: "estimated"`, and `configured_model` matching the cursor model name.
- [ ] `bun run typecheck` passes.
- [ ] `bun test` passes.

## Documentation updates

- Update `docs/run-loop.md` with a short cursor-estimation section per the bullets above.
- Note in `docs/agents.md` (or equivalent) that cursor usage is estimated, not measured, and that estimates undercount when cursor performs tool calls or sub-turns the CLI does not surface.
