# Codex finalize session usage and computed cost

`runCodexBinding` resolves a matched codex rollout JSONL, then returns the untouched `runAgent` ok
result (`usage_source` / `cost_source` both `"unavailable"`). Read the matched rollout, map
`total_token_usage` to telemetry usage, and settle list-price cost from the binding's `priceKey`.

## Decisions

- On `resolved.sessionFile !== null`, read that rollout and take the **last** `token_count` event with
  non-null `info` — rules out leaving the resolved file unused and rules out v1 max-total selection.
- Map `info.total_token_usage` to telemetry usage via fresh-input subtraction
  (`input_tokens - cached_input_tokens`, `output_tokens`, `cached_input_tokens` as
  `cache_read_input_tokens`) — rules out double-counting cached input in the usage record.
- Thread `priceKey` from `createResolvedAgentBinding` into `runCodexBinding` / finalize — rules out
  hard-coding or inferring catalog keys inside the adapter.
- Pass usage with fresh `input_tokens` into `computeCost`; `reasoning_output_tokens` is not mapped or
  billed separately — rules out double-billing cached input and rules out a separate reasoning line
  item.
- Priced `priceKey` → `computeCost` → `cost_source: "computed"`; absent catalog row → `no-price` —
  rules out fabricated dollars.
- `loadPrices()` is called per invocation on the with-usage finalize branch; a throw degrades to
  `cost_usd: null` / `cost_source: "no-price"` rather than failing the invocation — rules out catalog
  problems aborting an otherwise-successful codex run.
- Matched rollout with only `info: null` `token_count` events → `usage_source: "unavailable"`,
  `cost_source: "no-usage"` — rules out zero-token usage for rate-limited turns.
- Unreadable or malformed matched rollout → `usage_source: "unavailable"`, `cost_source: "no-usage"`,
  with a warning, without throwing — rules out parse failure killing an otherwise successful
  invocation.
- Unmatched session path unchanged (`no-usage`, existing resolver warnings) — rules out changing
  today's correlation-miss behavior.
- Computed `cost_usd` is published-rate list price, not billed spend — rules out presenting harness
  dollars as invoice spend.
- Out of scope: rewriting `resolveCodexSessionUsage`, snapshot/matcher helpers, cursor/claude paths,
  pricing table edits, telemetry `warnings` field plumbing beyond adapter `ok` result warnings.

## Tasks

- Pass `priceKey` from `createResolvedAgentBinding` into `runCodexBinding` and a codex finalize helper.
- On `resolved.sessionFile !== null`, parse the rollout for the last non-null `info` `token_count`
  event, map usage, call `computeCost(usage, priceKey, loadPrices())` on the with-usage branch, and
  replace the bare `return result;` success path; keep non-`ok` passthrough and the unmatched-session
  branch untouched.
- Add `agents.test.ts` coverage with injectable `codexSessionsDir` + `randomUUID`: correlated rollout
  fixtures for priced usage (`gpt-5.6-sol`, 35380 / 11008 cached / 282 → `0.135824`), all-null-info,
  multiple `token_count` events (last wins), unknown `priceKey`, and malformed JSONL. Write each
  fixture from a wrapper around the injected `spawn` so the file changes *after* the pre-invocation
  snapshot; carry the injected marker in a `user_message` `event_msg` and omit `cwd` events (or match
  the invoke `cwd`) so the resolver matches.
- Add the three `@mutate` directives (finalize call, cached-input subtraction, non-null `info` guard)
  on their pinning tests.
- Update `v2/docs/shared-invocation.md`, `v2/docs/operator-runbook.md` § Reading telemetry, and
  `v2/docs/v1-behaviors.md` (note last-event selection vs v1 max-total).
- Run `bun run typecheck`, `bun run test:shared`, `bun run test:v1`, `bun run test:v2`, and
  `bun run test:integration:v2`.

## Acceptance criteria

- [ ] `agents.test.ts` — matched rollout with non-null `token_count` `info` settles `ok` with
  `usage_source: "agent"`, mapped `usage` (`input_tokens: 24372`, `output_tokens: 282`,
  `cache_read_input_tokens: 11008`), `cost_source: "computed"`, and `cost_usd` matching
  `data/prices.json` for raw `total_token_usage` 35380 input / 11008 cached / 282 output on
  `gpt-5.6-sol` (`0.135824`); fails against the bare `return result` success path.
- [ ] `agents.test.ts` — matched rollout whose `token_count` events all carry `info: null` settles
  `usage_source: "unavailable"` and `cost_source: "no-usage"` without throwing.
- [ ] `agents.test.ts` — rollout with multiple `token_count` events uses the last non-null `info`
  event.
- [ ] `agents.test.ts` — priced usage with unknown `priceKey` keeps `cost_usd: null` and
  `cost_source: "no-price"`.
- [ ] `agents.test.ts` — unreadable or malformed matched rollout settles `usage_source: "unavailable"`
  and `cost_source: "no-usage"` with a warning, without throwing.
- [ ] `agents.test.ts` — `codex session usage unavailable remains ok with warning metadata` stays
  green.
- [ ] `agents.test.ts` — a `// @mutate` directive on the matched-session finalize call restoring the
  bare `return result;` success path turns the priced-usage pinning test RED.
- [ ] `agents.test.ts` — a `// @mutate` directive removing the cached-input subtraction from the
  mapped `input_tokens` turns the priced-usage pinning test RED.
- [ ] `agents.test.ts` — a `// @mutate` directive inverting the non-null `info` guard (so `info: null`
  events are accepted as usage) turns the all-null-info pinning test RED, proving the guard suppresses
  a zero-token `usage_source: "agent"` settlement.
- [ ] `bun run typecheck`, `bun run test:shared`, `bun run test:v1`, `bun run test:v2`, and
  `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/shared-invocation.md` — codex binding usage/cost settlement alongside cursor and opencode
  entries (`agent` + `computed` / `no-price` / `no-usage` / `unavailable`).
- `v2/docs/operator-runbook.md` § Reading telemetry — codex rows carry agent usage and computed
  list-price cost; document `no-usage` vs `no-price` vs `unavailable`.
- `v2/docs/v1-behaviors.md` — shared codex invocation finalize records session-derived usage and
  harness-computed list-price cost; last non-null `token_count` selection differs from v1 max-total.
