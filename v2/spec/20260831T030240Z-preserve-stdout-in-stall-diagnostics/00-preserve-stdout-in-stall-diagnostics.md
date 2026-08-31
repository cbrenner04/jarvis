# Preserve stdout in stall diagnostics

## Problem

When the idle-output watchdog fires, stall settlement carries only accumulated stderr; accumulated stdout is dropped. `logBindingInbound` already appends non-ok `result.stderr` verbatim, so a stdout-streaming lane (cursor with `--output-format stream-json --stream-partial-output`) can log zero inbound bytes after the binding line — reading as silence when the agent streamed minutes of work (issue #3151, run `0364af43-86ec-4587-a5ac-2e705dc2beff`).

## Decision ledger

- Carry stall diagnostics in the existing `stderr` field as `${errBuf}${outBuf}`, matching zero/non-zero settle branches; rules out a new result field or a stall-specific `logBindingInbound` branch.
- Leave watchdog firing, re-arming, process handling, and `kind: "stall"` classification unchanged; rules out folding this into timeout-budget policy work.

## Work

- Include buffered stdout in both shared invocation idle-stall settlement paths (`armIdleTimer` immediate settle and `joinProcessOnIdleStall` forced result) in `shared/invocation/agents.ts`.
- Extend `shared/invocation/agents.test.ts` regressions `idle output expiry settles stall without joining a silent child` and `idle output expiry joins the child before settling stall` to stream stdout and stderr before idle expiry and assert `${errBuf}${outBuf}` stall diagnostics on both paths.
- Add a `shared/invocation/agents.test.ts` session-log regression that drives a resolved binding through actual idle-stall settlement and `executeWithQuotaFallback` (no mocked `stall` result), then asserts combined diagnostics land only under `inbound_stderr`.
- Extend that session-log regression with an output-silent idle-stall case so an empty stalled inbound payload still proves real silence.
- Keep `cursor binding still stalls on output-silent invocation past idleOutputMs` asserting `{ kind: "stall", stderr: "" }`.
- Update operator diagnosis, parity baseline, and shared-invocation contract per Documentation updates.

## Acceptance criteria

- [ ] `shared/invocation/agents.test.ts` tests `idle output expiry settles stall without joining a silent child` and `idle output expiry joins the child before settling stall` each stream stderr and stdout before idle expiry and assert a `stall` whose `stderr` is `${errBuf}${outBuf}` in that order; both fail against stderr-only stall settlement.
- [ ] A `shared/invocation/agents.test.ts` session-log regression runs a resolved, stdout-streaming binding through actual idle-stall settlement and `executeWithQuotaFallback`, then verifies the stream is recorded only as combined `inbound_stderr` diagnostics; it fails against the pre-fix stderr-only settlement.
- [ ] The same session-log regression proves an output-silent stalled binding writes no `inbound_stdout` or `inbound_stderr` payload, distinguishing real silence from a discarded stdout buffer.
- [ ] `shared/invocation/agents.test.ts` test `cursor binding still stalls on output-silent invocation past idleOutputMs` stays green (silent stall diagnostics unchanged).
- [ ] `shared/invocation/agents.test.ts` tests `output clears the previous idle expiry`, `worktree activity re-arms the idle timer for a silent child`, `sidecar-only worktree activity does not re-arm the idle timer`, and `claude binding threads idleOutputMs through and re-arms the idle timer on stdout` stay green (watchdog timing, re-arming, and process handling unchanged).
- [ ] `shared/invocation/execute.test.ts` test `stops on stall instead of advancing the default binding chain` and `v2/src/daemon/run-operator-error.test.ts` test `composeRunOperatorError maps failureKind %s from log and store-only failed paths` stay green (`stall` classification unchanged).
- [ ] `v2/docs/operator-runbook.md`, `v2/docs/v1-behaviors.md`, and `v2/docs/shared-invocation.md` state that stalled stdout is appended to diagnostics and written under `inbound_stderr`, never `inbound_stdout`; an empty stalled inbound payload means real silence.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v1` passes.
- [ ] `bun run test:integration:v1` passes.
- [ ] `bun run test:v2` passes.
- [ ] `bun run test:integration:v2` passes.
- [ ] `bun run test:shared` passes.
- [ ] `bun run test:integration:shared` passes.

## Documentation updates

- `v2/docs/operator-runbook.md` — `role_stalled` / `idle_output_timeout` diagnosis notes that the session log carries the stalled agent's streamed stdout as combined `inbound_stderr` diagnostics, so an empty stalled inbound payload is real silence, not a discarded buffer.
- `v2/docs/v1-behaviors.md` — record the corrected shared stall-diagnostics behavior in the parity baseline, including `inbound_stderr` rather than `inbound_stdout`.
- `v2/docs/shared-invocation.md` — correct the authoritative non-ok session-log contract: a stalled result carries combined stderr then stdout diagnostics under `inbound_stderr`.
