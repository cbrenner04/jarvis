---
name: codex-usage-is-never-recorded
---

# Codex usage discovery succeeds and is then thrown away, so a codex-led session has no agent cost

## Problem

`runCodexBinding` (`shared/invocation/agents.ts`) resolves the codex session rollout for an
invocation, then does nothing with it:

```ts
const resolved = resolveCodexSessionUsage({ sessionsDir, beforeSnapshot, invocationMarker, cwd });
if (resolved.sessionFile === null) {
  return { ...result, usage_source: "unavailable", cost_usd: null, cost_source: "no-usage", warnings: resolved.warnings };
}
return result; // session file found — never opened, never parsed, never costed
```

Only the **failure** branch is implemented. On success the untouched `result` keeps `runAgent`'s
defaults (`usage_source: "unavailable"`, `cost_source: "unavailable"`), so every codex row reports no
usage and no cost. Codex is metered, so this is unbilled spend the operator cannot see.

This is **not** a discovery or matching bug, and **not** a missing price entry. Do not rewrite
`resolveCodexSessionUsage`, `snapshotCodexSessionFiles`, or `listChangedCodexSessionFiles`.

## Evidence

Session of 2026-08-02/03: 58 codex invocations, 45 with `exit_kind: "ok"`. **All 45 recorded
`usage_source: "unavailable"` and `cost_source: "unavailable"`.**

That pair is the proof. The not-found branch writes `cost_source: "no-usage"`; the runAgent default is
`"unavailable"`. Every ok row shows `"unavailable"`, so `resolveCodexSessionUsage` returned a session
file every time and the success path discarded it.

Confirmed against a real rollout (`~/.codex/sessions/2026/08/02/rollout-...-019fc5a3-3ae8-....jsonl`,
codex-cli 0.145.0): it contains the `jarvis-codex-invocation` marker, a matching worktree `cwd`, and a
`token_count` event — all three match conditions hold.

Usage lives at `payload.info` on a `token_count` event:

```json
{"total_token_usage": {"input_tokens": 35380, "cached_input_tokens": 11008,
  "cache_write_input_tokens": 0, "output_tokens": 282,
  "reasoning_output_tokens": 62, "total_tokens": 35662},
 "last_token_usage": {}, "model_context_window": 258400}
```

`total_tokens (35662) == input_tokens (35380) + output_tokens (282)`, so **`input_tokens` already
includes `cached_input_tokens`** — subtract before applying the input rate or cached tokens are
billed twice.

`gpt-5.6-sol` and `gpt-5.6-terra` are both already priced in `data/prices.json` (with
`cache_read_per_mtok`, no `cache_write_per_mtok`).

**`info` can be `null`.** A rate-limited turn emits `token_count` carrying only `rate_limits`
(observed once codex hit its usage limit at 01:50Z). `sessionContentHasTokenCountEvent` passing
therefore does not guarantee usage exists.

Separately: the telemetry row schema has **no `warnings` field**, so every
`codex usage unavailable: ...` warning the adapter produces is dropped. That is why this survived
several sessions unnoticed.

## Decisions

- Implement the success path: read the matched rollout, take the **last** `token_count` event whose
  `info` is non-null, and stamp `usage` from `info.total_token_usage` with `usage_source: "agent"` —
  rules out leaving the resolved session file unused. Session-cumulative `total_token_usage` is the
  correct attribution because the invocation marker is unique per invocation, so a matched session is
  that invocation.
- Compute `cost_usd` from `data/prices.json` as
  `(input_tokens - cached_input_tokens) x input_rate + cached_input_tokens x cache_read_rate +
  output_tokens x output_rate`, recording `cost_source: "computed"` — rules out double-billing cached
  input. `reasoning_output_tokens` is a subset of `output_tokens`; do not add it separately.
- A matched session whose `token_count` events all carry `info: null` records
  `usage_source: "unavailable"` and `cost_source: "no-usage"` — rules out reporting zero tokens as
  real usage for a rate-limited turn.
- A model absent from `data/prices.json` keeps the existing `no-price` marker — rules out a wrong
  number.
- Carry adapter `warnings` onto the telemetry row so a future regression in this path is visible
  without reading source — rules out repeating this silent failure.
- Out of scope: session discovery and matching (they work), the cursor and claude paths, and any
  rework of the pricing table beyond reading it.

## Acceptance criteria

- [ ] A codex invocation whose matched rollout carries a `token_count` event with non-null `info`
      records `usage` from `total_token_usage` with `usage_source: "agent"`; the regression fails
      against the current adapter, which returns `result` unchanged.
- [ ] That row carries `cost_usd` computed with cached input subtracted from billable input, and
      `cost_source: "computed"`. A fixture with the observed numbers (35380 input / 11008 cached /
      282 output on `gpt-5.6-sol`) asserts the exact dollar figure.
- [ ] A matched rollout whose `token_count` events all have `info: null` records
      `usage_source: "unavailable"` and `cost_source: "no-usage"` without throwing.
- [ ] A rollout with several `token_count` events uses the last one with non-null `info`.
- [ ] A resolved model absent from `data/prices.json` records `no-price` and a null `cost_usd`.
- [ ] The unmatched-session path still records `no-usage` exactly as it does today.
- [ ] Adapter `warnings` appear on the emitted telemetry row.
- [ ] Mutation checkpoint: a `// @mutate` directive that restores the bare `return result;` success
      path turns the usage regression RED.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Reading telemetry — codex rows carry usage and computed cost, and
  what `no-usage` vs `no-price` vs `unavailable` each mean.

## Prerequisites

- The cursor usage/cost path shipped in #2431, #2433, #2446 (`shared/invocation/`, `data/prices.json`)
- `resolveCodexSessionUsage` and its match conditions in `shared/invocation/agents.ts` (working; do
  not rewrite)
