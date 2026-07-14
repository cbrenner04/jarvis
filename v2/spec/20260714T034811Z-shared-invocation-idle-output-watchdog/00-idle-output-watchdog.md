# Abort and classify an idle invocation as a stall

`shared/invocation` arms no liveness watchdog: `singleSpawn` (`shared/invocation/agents.ts`)
kills the child only on the caller's `AbortSignal`, so a silent agent runs until the caller's
wall clock. Give the shared path an idle-output watchdog: a caller-supplied idle budget, bumped
by every stdout/stderr chunk, that aborts the child on expiry and settles a distinct `stall`
result kind.

Detection + abort + classification only. Consuming the stall (binding advance, escalation) and
recording it (telemetry `exit_reason` semantics beyond the existing default, operator
diagnostics) are separate behaviors.

## Decisions

- Budget is one caller-supplied `idleOutputMs` on `executeWithQuotaFallback` args, threaded into every `binding.invoke` call — not per-binding config. Per-profile/per-rung budgets are the liveness-profile work; a flat option rules out baking a profile table into the seam before its consumer exists.
- `undefined` or `0` disables the watchdog — existing callers stay byte-for-byte unchanged, ruling out a defaulted budget that would silently start killing v2 write-loop invocations this spec has not measured.
- New result kind `{ kind: "stall"; stderr: string }` in the `InvocationResult` union, not a flavored `error` or a `quota` variant — the intent's contract is that stall is distinguishable from `quota`, `model_config`, and generic `error` at the type level, so downstream `switch` sites fail typecheck until they decide.
- Default `shouldAdvance` stays `result.kind === "quota"` — stall is terminal for every current caller; advancing on stall is the deferred consumer behavior.
- Idle expiry reuses `singleSpawn`'s existing process-group kill (`SIGTERM` to `-pgid`, `SIGKILL` after `abortKillGraceMs`) rather than a second kill path, but settles `stall`, not `aborted: <reason>` error.
- Stall does not trigger `runAgent`'s transient-retry loop (it retries only `kind: "error"` transient signals) — a stalled agent re-spawned identically stalls again.
- Timer is injectable (clock/timer seam in `AgentRunOptions`) so tests assert the abort without real waiting; ruling out sleep-based tests that would add ten-minute-scale wall time.
- Deferred to first consumer: whether cursor bindings may carry a budget at all (cursor emits no partial output, so any budget kills it) — callers choose; shared invocation does not special-case agents.
- Deferred to first consumer: `exit_reason` shape for stall rows; the existing `createInvocationCompletedRecord` default (non-`ok`, non-`error` → `stderr`) applies unchanged.

## Task checklist

- [ ] Add `InvocationStall` to the `InvocationResult` union in `shared/invocation/execute.ts` and thread `idleOutputMs` from `executeWithQuotaFallback` args into `binding.invoke`.
- [ ] Arm the idle watchdog in `singleSpawn`: bump last-output on every stdout/stderr chunk; on expiry kill the process group and settle `stall`.
- [ ] Cover the new switch/branch sites (session-log tagging, telemetry record) for the widened union.
- [ ] Tests: expiry aborts and settles `stall`; chunked output defers expiry; unset/`0` budget never fires; stall is not `quota` and does not advance the default binding chain.
- [ ] Docs.

## Acceptance criteria

- [ ] A binding invocation whose child emits no stdout/stderr for the caller-supplied idle budget has its process group killed and settles as `kind: "stall"`; a new test in `shared/invocation/agents.test.ts` drives a silent fake child under an injected timer and fails against the pre-fix code (which never settles until the child exits).
- [ ] Output resets the budget: a child emitting a chunk each half-budget runs to normal completion and settles `ok`, asserted by a new test that fails against a naive wall-clock implementation.
- [ ] An unset or `0` idle budget arms nothing: existing `shared/invocation` tests stay green with no timer injected.
- [ ] A stalled invocation is not classified as `quota` and, under the default `shouldAdvance`, stops the binding chain instead of advancing to the next binding — asserted by a new `shared/invocation/execute.test.ts` test.
- [ ] `bun run typecheck` passes: the widened union forces every result-kind consumer in `shared/**`, `v1/**`, and `v2/**` to handle `stall` explicitly.

## Documentation updates

- [ ] `v2/docs/invocation-liveness.md` — record agent-output stall detection as shipped in shared invocation with a caller-supplied budget; remove it from the deferred list, leaving workspace/marker categories, profiles, and stall-driven binding advance deferred.
- [ ] `v2/docs/shared-invocation.md` — `stall` as a settled result kind, the `idleOutputMs` input, disabled-by-default semantics, and that default fallback does not advance on stall.
- [ ] `v2/docs/v1-behaviors.md` — update the invocation-liveness divergence row: v2 now has stdout/stderr-only stall detection in shared invocation (no mtime signal, no cascade), against v1's `max(output idle, file idle)` + ladder escalation.
