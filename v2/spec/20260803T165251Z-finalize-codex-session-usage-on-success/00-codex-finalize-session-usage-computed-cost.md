# Codex finalize session usage and computed cost

`runCodexBinding` resolves a matched codex rollout JSONL, then returns the untouched `runAgent` ok
result (`usage_source` / `cost_source` both `"unavailable"`). Read the matched rollout, map
`total_token_usage` to telemetry usage, and settle list-price cost from the binding's `priceKey`.

## Decisions

- On `resolved.sessionFile !== null`, read that rollout and take the **last** `token_count` event with
  non-null `info` — rules out leaving the resolved file unused and rules out v1 max-total selection.
  Codex `total_token_usage` is cumulative per session; the terminal non-null event is the session
  total, whereas v1 max-total can pick an earlier spike when totals decrease mid-rollout.
- Map `info.total_token_usage` mirroring v1 `extractTokenUsage`: per-field `numberOrNull`;
  `Math.max(0, input - cached)` for billable `input_tokens`; `cache_read_input_tokens` from
  `cached_input_tokens`; `cache_creation_input_tokens: null`; non-object `total_token_usage` →
  unextractable (no usage object) — rules out naked subtraction on missing fields, `cached > input`,
  and negative cost.
- When the mapper yields a usage object whose fields are all `null`, settle `usage_source: "agent"` and
  `cost_source: "no-usage"` via `computeCost` (cursor precedent) — distinct from the all-`info: null`
  branch.
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
  `cost_source: "no-usage"`, plus a warning — rules out zero-token usage for rate-limited turns and
  indistinguishability from a correlation miss in telemetry.
- Matched rollout with a selected non-null `info` event whose usage is unextractable (mapper returns
  `null`, e.g. non-object `total_token_usage`) → `usage_source: "unavailable"`, `cost_source:
  "no-usage"`, with a warning, without throwing — rules out bad shape on an otherwise-successful
  invocation.
- Degrade-without-throw applies only to **file read + JSONL line parse**; mapping and shape handling
  follow the explicit branches above (not a broad try/catch that would swallow guard-inversion
  failures into the same `unavailable`/`no-usage` outcome as all-`info: null`).
- Priced success path spreads `...result` from `runAgent` and overlays usage/cost fields (preserves
  `stdout`, `stderr`, and any existing `warnings`) — unlike cursor, which rebuilds `InvocationOk` from
  parsed stdout.
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
  fixtures for priced usage (`gpt-5.6-sol`, 35380 / 11008 cached / 282), all-null-info (assert
  warning), multiple `token_count` events with a **decreasing** final non-null total plus a trailing
  `info: null` event (last-wins, not max-total), unknown `priceKey`, and partially parseable rollout
  with non-null `info` but non-object `total_token_usage`. Write each fixture from a wrapper around
  the injected `spawn` so the file changes *after* the pre-invocation snapshot; carry the injected
  marker in a `user_message` `event_msg` and omit `cwd` events (or match the invoke `cwd`) so the
  resolver matches.
- Drive `executeWithQuotaFallback` in the priced-usage test and assert `rows[0]` carries usage/cost
  (mirror cursor priced-usage telemetry assertion).
- Add the three `@mutate` directives (finalize call, cached-input subtraction, non-null `info` guard)
  on their pinning tests.
- Update `v2/docs/shared-invocation.md`, `v2/docs/operator-runbook.md` § Reading telemetry, and
  `v2/docs/v1-behaviors.md` (note last-event selection vs v1 max-total).
- Run `bun run typecheck`, `bun run test:shared`, `bun run test:v1`, `bun run test:v2`,
  `bun run test:integration:v1`, `bun run test:integration:shared`, and
  `bun run test:integration:v2`.

## Acceptance criteria

- [x] `agents.test.ts` — matched rollout with non-null `token_count` `info` settles `ok` with
  `usage_source: "agent"`, mapped `usage` (`input_tokens: 24372`, `output_tokens: 282`,
  `cache_read_input_tokens: 11008`), `cost_source: "computed"`, and `cost_usd` within tolerance of
  `computeCost` against `data/prices.json` for raw `total_token_usage` 35380 input / 11008 cached /
  282 output on `gpt-5.6-sol` (document expected ≈`0.135824`; catalog-coupled, use `toBeCloseTo` not
  exact equality); `executeWithQuotaFallback` telemetry `rows[0]` matches the same usage/cost fields;
  fails against the bare `return result` success path.
- [x] `agents.test.ts` — matched rollout whose `token_count` events all carry `info: null` settles
  `usage_source: "unavailable"`, `cost_source: "no-usage"`, and a warning, without throwing.
- [x] `agents.test.ts` — rollout with multiple `token_count` events including a decreasing final
  non-null total and a trailing `info: null` event uses the last non-null `info` event (not v1
  max-total).
- [x] `agents.test.ts` — priced usage with unknown `priceKey` keeps `cost_usd: null` and
  `cost_source: "no-price"`.
- [x] `agents.test.ts` — matched rollout with non-null `info` but unextractable usage shape (e.g.
  non-object `total_token_usage` on the selected event) settles `usage_source: "unavailable"` and
  `cost_source: "no-usage"` with a warning, without throwing.
- [x] `agents.test.ts` — `codex session usage unavailable remains ok with warning metadata` stays
  green.
- [x] `agents.test.ts` — a `// @mutate` directive on the matched-session finalize call restoring the
  bare `return result;` success path turns the priced-usage pinning test RED.
- [x] `agents.test.ts` — a `// @mutate` directive removing the cached-input subtraction from the
  mapped `input_tokens` turns the priced-usage pinning test RED.
- [x] `agents.test.ts` — a `// @mutate` directive disabling the `all-info-null` dispatch branch turns
  the all-null-info pinning test RED on its warning text, proving that branch is load-bearing rather
  than redundant with the unextractable-usage fallthrough (both settle `unavailable`/`no-usage`, so
  the warning is the only discriminator). Inverting the non-null `info` guard itself cannot yield
  agent-settled zero-token usage — `info: null` events map to no usage either way — so the pinning
  test asserts the exact warning instead.
- [x] `bun run typecheck`, `bun run test:shared`, `bun run test:v1`, `bun run test:v2`,
  `bun run test:integration:v1`, `bun run test:integration:shared`, and
  `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/shared-invocation.md` — codex binding usage/cost settlement alongside cursor and opencode
  entries (`agent` + `computed` / `no-price` / `no-usage` / `unavailable`).
- `v2/docs/operator-runbook.md` § Reading telemetry — codex rows carry agent usage and computed
  list-price cost; document `no-usage` vs `no-price` vs `unavailable`.
- `v2/docs/v1-behaviors.md` — shared codex invocation finalize records session-derived usage and
  harness-computed list-price cost; last non-null `token_count` selection differs from v1 max-total.
