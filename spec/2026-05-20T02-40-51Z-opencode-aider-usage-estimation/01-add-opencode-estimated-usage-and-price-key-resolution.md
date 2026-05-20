# 01 - Add opencode estimated usage and price-key resolution

## Problem

`src/agents/opencode.ts` currently records every successful run as `usage_source: "unavailable"` and `cost_source: "no-usage"` even though jarvis already has enough information to estimate prompt and stdout tokens. The patch loop also prints an opencode-specific notice that assumes this unavailable path is always normal.

## Decisions

- Opencode will use the shared token estimator on successful runs, using the sent prompt and captured stdout.
- `OPENCODE_HAS_PRICED_MODELS` becomes `true`.
- `resolveOpencodePriceKey` returns the configured opencode model string unchanged so telemetry can look it up directly in `data/prices.json`.
- Price-table maintenance remains operator-managed; this subspec does not add or edit `data/prices.json`.
- If estimation fails, opencode falls back to the current unavailable/no-usage behavior and adds one warning to the returned `AgentResult`.
- The patch-loop notice in `src/modes/patch/run.ts` must stop firing on normal successful estimated opencode runs and only remain for real unavailable fallback cases.
- This subspec must cover both layers it changes: agent-local result shaping in `src/agents/opencode.ts` and the downstream enrichment/notice behavior that consumes those results.

## Task Checklist

- [ ] Wire the shared estimator into `src/agents/opencode.ts`.
- [ ] Update opencode pricing metadata so downstream enrichment can compute cost from the configured model string when a matching price row exists.
- [ ] Narrow or remove the patch-loop opencode unavailable notice so successful estimated runs do not print it.
- [ ] Add regression coverage for opencode success and fallback branches plus the downstream pricing/notice paths this slice changes.

## Documentation updates

- [ ] Leave operator-facing prose changes for the dedicated documentation subspec, but keep inline code comments accurate anywhere opencode usage accounting semantics change.

## Acceptance criteria

- [ ] Successful opencode runs estimate tokens from prompt and stdout, attach those counts to the agent result, and return `usage_source: "estimated"` rather than `unavailable`.
- [ ] `resolveOpencodePriceKey` returns the configured model string unchanged, allowing downstream pricing to use existing `data/prices.json` rows when present.
- [ ] Downstream usage/cost enrichment records `cost_source: "estimated"` when an estimated opencode result is paired with a configured model that has a matching price-table row, and `cost_source: "no-price"` when the model string has no matching row.
- [ ] If estimation fails, opencode still returns a successful agent result with `usage_source: "unavailable"`, `cost_source: "no-usage"`, and exactly one warning explaining the fallback.
- [ ] The patch loop no longer prints `opencode: token usage not available for this CLI version...` for successful estimated opencode runs.
- [ ] Any remaining opencode unavailable notice path is tied to actual unavailable fallback behavior, not normal success.
- [ ] Regression coverage proves the opencode success path, identity price-key resolution, estimator-failure warning fallback, and the downstream priced-vs-unpriced enrichment outcomes introduced by this slice.
