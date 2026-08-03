---
name: finalize-codex-session-usage-on-success
---

# Finalize codex session usage on success

Unsplit rationale: Session usage finalize and telemetry warning propagation both live in `shared/invocation/` and ship as one codex billing fix.

## Module-boundary surface

- Shared invocation: codex binding finalize and `invocation_completed` telemetry assembly.

## Problem

`runCodexBinding` resolves a matched codex rollout JSONL, then returns the untouched `runAgent` ok result
(`usage_source` / `cost_source` both `"unavailable"`). Metered codex spend is invisible. Adapter
`warnings` are set on `InvocationOk` but dropped because `InvocationCompletedRecord` has no `warnings`
field.

## Decisions

- On `resolved.sessionFile !== null`, read that rollout and take the last `token_count` event with
  non-null `info`, stamping `usage` from `info.total_token_usage` and `usage_source: "agent"` — rules
  out leaving the resolved file unused and rules out v1 max-total selection.
- Subtract `cached_input_tokens` from billable `input_tokens` before `computeCost` — rules out
  double-billing cached input; `reasoning_output_tokens` is not added separately.
- Priced `priceKey` → `computeCost` → `cost_source: "computed"`; absent catalog row → `no-price` —
  rules out fabricated dollars.
- Matched rollout with only `info: null` `token_count` events → `usage_source: "unavailable"`,
  `cost_source: "no-usage"` — rules out zero-token usage for rate-limited turns.
- Unmatched session path unchanged (`no-usage` + adapter warnings).
- Copy non-empty `InvocationOk.warnings` onto `invocation_completed` rows — rules out silent adapter
  diagnostics.
- Out of scope: rewriting `resolveCodexSessionUsage`, snapshot/matcher helpers, cursor/claude paths,
  pricing table edits.

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
- [ ] `agents.test.ts` — unmatched-session path still records `cost_source: "no-usage"` exactly as
  today.
- [ ] `agents.test.ts` — adapter `warnings` appear on the emitted `invocation_completed` row.
- [ ] `agents.test.ts` — a `// @mutate` directive restoring the bare `return result;` success path
  turns the usage regression RED.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Reading telemetry — codex rows carry agent usage and computed
  cost; document `no-usage` vs `no-price` vs `unavailable`.
- `v2/docs/v1-behaviors.md` — record shared codex invocation usage/cost finalize when behavior
  differs from v1 parity baseline.

## Prerequisites

- Shared invocation records cursor agent usage and computed list-price cost from `data/prices.json`.
- `resolveCodexSessionUsage` resolves a unique codex rollout JSONL per invocation marker and cwd.
