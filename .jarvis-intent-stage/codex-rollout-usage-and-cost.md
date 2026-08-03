---
name: codex-rollout-usage-and-cost
---

# Codex invocations record usage and computed cost from the matched rollout

## Problem

`runCodexBinding` (`shared/invocation/agents.ts`) resolves the codex session rollout for an
invocation and then throws it away: only the not-found branch is implemented, and the success path
does `return result;`, keeping `runAgent`'s defaults (`usage_source: "unavailable"`,
`cost_source: "unavailable"`). Codex is metered, so every codex row is unbilled spend the operator
cannot see. Session of 2026-08-02/03: 58 codex invocations, 45 with `exit_kind: "ok"`, all 45
reporting `"unavailable"`/`"unavailable"` — that pair proves discovery matched and the result was
discarded (the not-found branch would have written `no-usage`).

Discovery and matching work and are not in scope: do not rewrite `resolveCodexSessionUsage`,
`snapshotCodexSessionFiles`, or `listChangedCodexSessionFiles`.

Rollout shape (codex-cli 0.145.0): usage lives at `payload.info.total_token_usage` on a
`token_count` event — `input_tokens`, `cached_input_tokens`, `output_tokens`,
`reasoning_output_tokens`, `total_tokens`. Observed `total_tokens (35662) == input_tokens (35380) +
output_tokens (282)`, so `input_tokens` already includes `cached_input_tokens`. `info` can be
`null`: a rate-limited turn emits `token_count` carrying only `rate_limits`.

## Decisions

- Read the matched rollout and stamp `usage` from the last `token_count` event with non-null `info`, `usage_source: "agent"` — rules out leaving the resolved session file unused. Session-cumulative `total_token_usage` is correct attribution because the invocation marker is unique per invocation.
- Compute `cost_usd` as `(input_tokens - cached_input_tokens) x input_rate + cached_input_tokens x cache_read_rate + output_tokens x output_rate`, `cost_source: "computed"` — rules out double-billing cached input, which `input_tokens` already includes.
- Do not add `reasoning_output_tokens` to `output_tokens` — it is a subset.
- A matched rollout whose `token_count` events all carry `info: null` records `usage_source: "unavailable"` and `cost_source: "no-usage"` — rules out reporting a rate-limited turn's zero tokens as real usage.
- A model absent from `data/prices.json` keeps the existing `no-price` marker and a null `cost_usd` — rules out a wrong number.
- An unreadable or malformed rollout degrades to the existing unavailable/`no-usage` settlement with a warning rather than throwing — rules out a parse failure killing an otherwise successful invocation.
- Out of scope: session discovery and matching, the cursor and claude paths, and any rework of the pricing table beyond reading it.

## Acceptance criteria

- [ ] A codex invocation whose matched rollout carries a `token_count` event with non-null `info` records usage from `total_token_usage` with `usage_source: "agent"`; the regression fails against the current adapter, which returns `result` unchanged.
- [ ] That row carries `cost_usd` with cached input subtracted from billable input and `cost_source: "computed"`; a fixture with the observed numbers (35380 input / 11008 cached / 282 output on `gpt-5.6-sol`) asserts the exact dollar figure.
- [ ] A matched rollout whose `token_count` events all have `info: null` records `usage_source: "unavailable"` and `cost_source: "no-usage"` without throwing.
- [ ] A rollout with several `token_count` events uses the last one with non-null `info`.
- [ ] A resolved model absent from `data/prices.json` records `no-price` and a null `cost_usd`.
- [ ] The unmatched-session path still records `no-usage` exactly as it does today.
- [ ] Warnings the codex path produces reach the emitted telemetry row.
- [ ] Mutation checkpoint: a `// @mutate` directive restoring the bare `return result;` success path turns the usage regression RED.

## Documentation updates

- `v2/docs/shared-invocation.md` — codex binding usage/cost settlement, alongside the cursor and opencode entries.
- `v2/docs/operator-runbook.md` § Reading telemetry — codex rows carry usage and computed cost; what `no-usage`, `no-price`, and `unavailable` each mean.

## Prerequisites

- Codex session discovery matches a rollout to an invocation by marker and cwd and returns the matched file path, warning instead of guessing on zero or multiple matches.
- `computeCost` prices a usage record against `data/prices.json`, settling `computed`, `no-price`, or `no-usage`.
- `gpt-5.6-sol` and `gpt-5.6-terra` have price rows with `cache_read_per_mtok`.
- Invocation telemetry rows carry adapter warnings.
