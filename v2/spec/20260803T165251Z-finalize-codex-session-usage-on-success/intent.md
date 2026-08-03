---
name: finalize-codex-session-usage-on-success
---

# Finalize codex session usage on success

## Module-boundary surface

- Shared invocation: codex binding finalize.

## Problem

`runCodexBinding` resolves a matched codex rollout JSONL, then returns the untouched `runAgent` ok result
(`usage_source` / `cost_source` both `"unavailable"`). Metered codex spend is invisible.

## Decisions

- On `resolved.sessionFile !== null`, read that rollout and take the last `token_count` event with
  non-null `info`, stamping `usage` from `info.total_token_usage` and `usage_source: "agent"` — rules
  out leaving the resolved file unused and rules out v1 max-total selection.
- Map `total_token_usage` to telemetry usage via fresh-input subtraction
  (`input_tokens - cached_input_tokens`, `output_tokens`, `cached_input_tokens` as
  `cache_read_input_tokens`) — rules out double-counting cached input in the usage record.
- Thread `priceKey` into `runCodexBinding` for `computeCost`, same as cursor — rules out
  hard-coding or inferring catalog keys inside the adapter.
- Subtract `cached_input_tokens` from billable `input_tokens` before `computeCost` — rules out
  double-billing cached input; `reasoning_output_tokens` is not added separately.
- Priced `priceKey` → `computeCost` → `cost_source: "computed"`; absent catalog row → `no-price` —
  rules out fabricated dollars.
- Matched rollout with only `info: null` `token_count` events → `usage_source: "unavailable"`,
  `cost_source: "no-usage"` — rules out zero-token usage for rate-limited turns.
- Unreadable or malformed rollout degrades to `usage_source: "unavailable"`, `cost_source: "no-usage"`,
  with a warning, without throwing — rules out parse failure killing an otherwise successful invocation.
- Unmatched session path unchanged (`no-usage`).
- Out of scope: rewriting `resolveCodexSessionUsage`, snapshot/matcher helpers, cursor/claude paths,
  pricing table edits, telemetry `warnings` field (separate intent).

## Acceptance criteria

- [ ] `agents.test.ts` — matched rollout with non-null `token_count` `info` settles `ok` with
  `usage_source: "agent"`, mapped `usage`, `cost_source: "computed"`, and `cost_usd` matching
  `data/prices.json` for 35380 input / 11008 cached / 282 output on `gpt-5.6-sol` (`0.135824`);
  fails against the bare `return result` success path.
- [ ] `agents.test.ts` — matched rollout whose `token_count` events all carry `info: null` settles
  `usage_source: "unavailable"` and `cost_source: "no-usage"` without throwing.
- [ ] `agents.test.ts` — rollout with multiple `token_count` events uses the last non-null `info`
  event.
- [ ] `agents.test.ts` — priced usage with unknown `priceKey` keeps `cost_usd: null` and
  `cost_source: "no-price"`.
- [ ] `agents.test.ts` — unreadable or malformed matched rollout settles `usage_source: "unavailable"`
  and `cost_source: "no-usage"` with a warning, without throwing.
- [ ] `agents.test.ts` — unmatched-session path still records `cost_source: "no-usage"` exactly as
  today.
- [ ] `agents.test.ts` — a `// @mutate` directive restoring the bare `return result;` success path
  turns the usage regression RED.
- [ ] `bun run typecheck` and `bun run test:v1`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/shared-invocation.md` — codex binding usage/cost settlement, alongside cursor and opencode entries.
- `v2/docs/operator-runbook.md` § Reading telemetry — codex rows carry agent usage and computed
  cost; document `no-usage` vs `no-price` vs `unavailable`.
- `v2/docs/v1-behaviors.md` — record shared codex invocation usage/cost finalize when behavior
  differs from v1 parity baseline.

## Prerequisites

- Invocation telemetry rows carry adapter `warnings` (serial same-seam prerequisite; plan telemetry intent first).
- Shared invocation records cursor agent usage and computed list-price cost from `data/prices.json`.
- `resolveCodexSessionUsage` resolves a unique codex rollout JSONL per invocation marker and cwd.
