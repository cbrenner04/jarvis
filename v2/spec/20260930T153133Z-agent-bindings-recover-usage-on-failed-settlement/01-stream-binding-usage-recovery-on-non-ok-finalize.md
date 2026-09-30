# 01 — Stream-json bindings recover usage on non-ok finalize

`finalizeClaudeInvocationResult`, `finalizeCursorInvocationResult`, and `finalizeOpencodeInvocationResult` return non-`ok` results unchanged, so retained NDJSON on settled quota/stall/error/model_config/abort results is never parsed for token counters before telemetry.

## Decisions

- After `runAgent` settles (any `kind`), run the same stdout/diagnostics parsers used on `ok` finalize to best-effort attach usage — rules out skipping recovery when classification already chose quota/error.
- Recovery must not await extra I/O, change `kind`, or block settlement beyond synchronous buffer parsing — rules out re-spawn or session polling on the stream path.
- Recovery input buffer per binding and settled `kind` (must match subspec 00 retention; rules out reading only `result.stdout` on mocks): **claude** — `ok` → `stdout`; zero-exit/quota envelope and other `quota` → `stderr` stream-json buffer; `stall` → combined `stderr`; `error` / `model_config` / abort → `stdout` when retained else `stderr`; **cursor** — `ok` → scoped `stdout`; non-`ok` → parse NDJSON from `diagnostics` when set else classifier-scoped bytes in `stderr`; **opencode** — `ok` → scoped `stdout`; non-`ok` → `diagnostics` (full `--format json` stream) when set else `stdout`.
- Claude/cursor: usage from terminal authoritative snapshot (`parseClaudeJsonOutput` / `parseCursorJsonOutput` terminal `result` rules), not sums across cumulative counter frames — rules out summing monotonic totals when a later frame supersedes earlier ones.
- Opencode non-`ok`: last clean `step_finish` token snapshot from the recovery buffer, not summed frames — rules out double-counting cumulative totals on failed settlement; `ok` finalize keeps summed `step_finish` via `parseOpencodeJsonOutput` — rules out changing ok-path accumulation.
- Partial counters: populate nullable token fields, set `usage_source: "agent"` when any counter is numeric, list-price `computeCost` when `priceKey` and priced catalog allow, `cost_source` branches matching each binding's `ok` finalize — rules out fabricating zero tokens.
- When parsers find no usage, leave usage fields absent so telemetry stays unavailable — rules out empty objects implying agent reporting.
- Parser/warning failures during recovery append warnings only; they do not flip `kind` — rules out promoting non-ok to `ok` for usage.
- When the settled result already carries `warnings` and recovery adds warnings, concatenate recovery warnings after existing entries — rules out replacing settlement warnings.
- `executeWithQuotaFallback` multi-binding chains: each attempt's recovered usage stays on that attempt's settled result only — rules out cross-attempt aggregation.
- Result types and `createInvocationCompletedRecord` are consumed as landed by `invocation-completed-records-failure-usage` — rules out editing `execute.ts` types or the mapper in this lane.

## Tasks

- Refactor finalize helpers (shared internal recovery helper acceptable) so claude, cursor, and opencode invoke stream recovery on every settled result before return, using the buffer ledger above.
- Add `shared/invocation/opencode-json.test.ts` with a multi-`step_finish` summing case if no shared test pins ok-path accumulation yet.
- Extend `agents.test.ts` with injected `fakeSpawn` stream fixtures (no ambient machine config): non-ok quota/error/stall/model_config exits retain recovered usage; cumulative-style frames assert terminal snapshot not summed totals on non-ok; two-binding fallback asserts distinct usage per attempt; spawn failure before any stdout leaves usage null; failure after partial usage vs immediate failure without usage; abort after partial stream usage (depends on subspec 00 retention).
- Update `v2/docs/shared-invocation.md` and `v2/docs/v1-behaviors.md` per Documentation updates.
- Run `bun run typecheck`, `bun run test:shared`, `bun run test:integration:shared`, `bun run test:v2`, and `bun run test:integration:v2`.

## Acceptance criteria

- [ ] `agents.test.ts` — claude binding fixtures: non-ok exit with retained stream-json carrying terminal `usage` settles non-`ok` with recovered counters and `usage_source: "agent"`; claude zero-exit quota envelope path uses `stderr` buffer; fails against pre-fix finalize that returns early on `kind !== "ok"`.
- [ ] `agents.test.ts` — cursor binding fixtures: non-ok recovery using terminal `type: "result"` `usage` from retained buffers; stream-backed quota and stall/model_config kinds covered; fails against pre-fix passthrough finalize.
- [ ] `agents.test.ts` — opencode binding fixtures: non-ok exit after multiple cumulative `step_finish` frames records terminal snapshot counts, not the sum; fails against pre-fix passthrough finalize.
- [ ] `agents.test.ts` — abort after partial stream usage settles `error` with recovered usage once subspec 00 retention lands; fails against pre-fix finalize without parser pass.
- [ ] `agents.test.ts` — `executeWithQuotaFallback` with two injected stream bindings where the first settles `quota` with recovered usage and the second settles `ok` with different usage leaves both attempts' usage distinct on results and `invocation_completed` rows when driven through `execute.test.ts` or an agents-level helper test.
- [ ] `agents.test.ts` — non-ok stream with no parseable usage leaves usage unset/nullable on the settled result.
- [ ] `opencode-json.test.ts` — multi-`step_finish` summing test stays green (ok-path accumulation unchanged by non-ok terminal-snapshot work).
- [ ] `bun run typecheck`, `bun run test:shared`, `bun run test:integration:shared`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/shared-invocation.md` — document best-effort usage recovery on non-`ok` settlement and abort teardown for claude, cursor, and opencode; buffer sources per kind; terminal snapshot vs sum rule; partial usage provenance; warnings-only recovery errors; telemetry rows now reflect recovered fields (mapper owned by `invocation-completed-records-failure-usage`).
- `v2/docs/v1-behaviors.md` — add/update bullets under shared invocation: recovered usage on failed agent settlement reaches `invocation_completed` before fallback stops; cite `shared/invocation/agents.ts` and `execute.ts`.
