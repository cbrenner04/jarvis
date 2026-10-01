# Recover stream-binding usage on non-ok settlement

`finalizeClaudeInvocationResult`, `finalizeCursorInvocationResult`, and `finalizeOpencodeInvocationResult` return non-ok `InvocationResult` values unchanged, so quota, stall, error, model_config, idle-stall, and abort teardown from claude/cursor/opencode drop buffered NDJSON usage before telemetry even though sibling mapper work already accepts settlement on those kinds.

## Decisions

- Best-effort usage recovery runs before the binding returns a settled non-ok result to `executeWithQuotaFallback`, using the same authoritative parsers as the `ok` path on the invocation's retained stdout buffer (including observability `diagnostics` when it holds the full stream) — rules out reclassifying to `ok` or delaying settlement on async I/O.
- Claude and cursor take terminal authoritative snapshots (`type: "result"` usage fields); opencode keeps today's `parseOpencodeJsonOutput` semantics for which frames contribute counters — rules out summing repeated terminal snapshots on claude/cursor streams that emit multiple cumulative `result` events.
- Recovered settlement merges optional `usage`, `usage_source`, `cost_usd`, `cost_source`, and `warnings` onto the classified non-ok result without changing `kind`, `stderr`, `exitCode`, `authFailure`, or `diagnostics` — rules out promoting partial usage to a success exit.
- Partial counters populate the same optional fields as `ok` with explicit provenance (`usage_source`, adapter warnings); list-price `computeCost` on cursor when `priceKey` and fields allow; claude agent-reported cost when present — rules out inventing `"estimated"` usage from duration.
- Parser or cost failures append warnings only; absent counters leave usage null and sources at today's unavailable/no-usage defaults — rules out failing the invocation or altering exit kind.
- Idle-stall settlement already carries combined `errBuf`+`outBuf` on `stderr` (and `diagnostics` when `retainedDiagnosticsSpread` applies); stream recovery reads those fields on the settled stall result — rules out depending on executor-private `outBuf` after settle returns.
- Abort `settleAbort` today omits buffered stdout; `runAgent` must attach retained NDJSON (same `retainedDiagnosticsSpread` as quota/stall) on the settled abort error before bindings finalize — rules out satisfying abort AC with stall-only or finalize-only work.
- Claude non-ok stream recovery consults, in order: binding-retained stdout passed into finalize, `diagnostics` when it holds the full stream, then `stderr` for zero-exit quota envelopes that place NDJSON on `stderr` — rules out quota fixtures that never set `diagnostics` reading an empty stdout buffer.
- Pre-result binding failures (spawn reject before a typed result) stay out of scope — rules out conflating normalized `execute.ts` rejections with subprocess stream recovery.
- Out of scope: codex session rollout correlation (`01-recover-codex-session-usage-on-non-ok-settlement.md`) — rules out duplicating codex session wiring here.

## Tasks

- Thread retained NDJSON onto abort settlement in `runAgent` (`settleAbort`) per idle-stall vs abort decisions so finalize can recover when the pre-fix abort result carries no stream text.
- Thread stream recovery through claude, cursor, and opencode binding finalize/settle seams per decisions (shared merge helper acceptable when it avoids four divergent copies).
- Extend `shared/invocation/agents.test.ts` with injected `fakeSpawn` stream fixtures covering quota, error, model_config, stall, idle stall, abort teardown, cumulative-not-double-counted, two-binding fallback with distinct usage, missing counters null, failure after partial usage, and recovery warnings without kind change; no ambient agent sessions or machine config.
- Update docs per Documentation updates.

## Acceptance criteria

- [x] `shared/invocation/agents.test.ts` — stream-binding recovery regression (claude, cursor, opencode non-ok and abort teardown with injected NDJSON, cumulative terminal snapshot, distinct fallback-attempt usage, null when counters absent, pre-result spawn failure without usage, partial-then-failure, warnings-only recovery errors) fails against pre-fix finalize early returns on non-ok results.
- [x] `shared/invocation/execute.test.ts` — `non-ok bindings copy agent-sourced settlement onto invocation_completed rows` stays green.
- [x] `shared/invocation/agents.test.ts` — `cursor binding passes non-ok results through unnormalized` stays green.
- [x] `bun run typecheck`, `bun run test:shared`, and `bun run test:integration:shared` pass.

## Documentation updates

- `v2/docs/shared-invocation.md` — claude/cursor/opencode adapters recover usage on non-ok settlement from retained stream buffers, partial-counter provenance, abort/stall teardown, and warnings-only recovery failures; cross-link telemetry catalog where settlement copies to rows.
- `v2/docs/v1-behaviors.md` — amend shared claude/cursor/opencode invocation bullets so failed subprocess settlement can carry recovered usage before `invocation_completed` telemetry (supersede any implied ok-only finalize wording for those agents).
