# Daemon list/wait idle-timeout projection

## Problem

`jarvis run list` and `jarvis run wait` compose operator errors through `composeRunOperatorError`. After [00 - Operator-error idle-timeout projection](./00-operator-error-idle-timeout-projection.md), the composer can distinguish committed-progress `idle_output_timeout`, but integration fixtures still lack list/wait coverage and operator docs still describe unconditional stop / interim limbo.

## Prerequisites

- [00 - Operator-error idle-timeout projection](./00-operator-error-idle-timeout-projection.md) merged — `composeRunOperatorError` maps resumable `idle_output_timeout` to `nextAction: "resume"`.

## Decision ledger

- Subspec 01 is a **verification and documentation slice** — `run list` / `run wait` already derive from `composeRunOperatorError`; no independent production seam beyond subspec 00.
- `run list` / `run wait` project `resumable`, `error.retryable`, and `error.nextAction` for `idle_output_timeout` from the same terminal `loop_finished` fields the write loop wrote — rules out list/wait disagreeing with the composer on committed-progress stalls.
- Committed-progress (`resumable: true`) and no-progress (`resumable: false`) fixtures both use failed `runStatus` with matching terminal `loop_finished` — rules out treating durability as completion.
- Attempt-only rows without terminal `loop_finished` stay `resumable: false` with `nextAction: "stop"` — rules out store-only inference of checkpoint progress (operator-error tests already cover attempt-only; list/wait adds the three fixture classes here).
- Subspec 01 owns `daemon-host.md` list/wait projection and conditional `nextAction` rows — not `isResumeAdmitted` or full resume-admission claims (subspec 02).

## Tasks

- Add `daemon-wait-run-completion.test.ts` fixtures for committed-progress resumable, no-progress stop, and attempt-only stop without terminal log.
- Add list/wait precedence fixture for resumable `idle_output_timeout` over mappable last-attempt detail (mirrors subspec 00 unit precedence).
- Update `daemon-host.md` reason table for conditional `idle_output_timeout` rows (`retryable` / `nextAction` vs terminal `resumable`; alignment with `wait.resumable`).
- Reconcile `v1-behaviors.md` daemon list/wait projection prose; remove interim-limbo language.
- Reconcile `write-behavior.md` and `workflow-runner.md` interim-limbo / stop-only daemon admission deferral once list/wait projection is documented.

## Acceptance criteria

- [ ] `v2/src/daemon/daemon-wait-run-completion.test.ts` asserts `run list` and `run wait` project a committed-progress `idle_output_timeout` (`loop_finished.resumable: true`) as `resumable: true` with `error.nextAction: "resume"`; fails if subspec 00 were reverted to the baseline reachable via `run-operator-error.test.ts` `composeRunOperatorError maps idle_output_timeout as a failed, non-retryable terminal`.
- [ ] `daemon-wait-run-completion.test.ts` asserts no-committed-progress (`resumable: false`) and attempt-only (no matching `loop_finished`) `idle_output_timeout` rows remain `resumable: false` with `error.nextAction: "stop"`; regression guard — stays green and would fail if the resumable projection applied without terminal proof.
- [ ] `daemon-wait-run-completion.test.ts` `list and wait prefer resumable idle_output_timeout over blocked last attempt` stays green (regression guard for precedence over mappable last-attempt detail).
- [ ] `v2/docs/daemon-host.md` documents conditional `idle_output_timeout` `retryable` / `nextAction` (resumable vs non-resumable terminal rows) and alignment with `wait.resumable`; does not claim `isResumeAdmitted` / full resume admission (subspec 02).
- [ ] `v2/docs/v1-behaviors.md` records daemon list/wait projection of conditional `idle_output_timeout` resumability (no resume-admission claim until subspec 02).
- [ ] `v2/docs/write-behavior.md` and `v2/docs/workflow-runner.md` no longer defer daemon `list`/`wait`/`resume` admission for committed-progress `idle_output_timeout` as interim limbo once projection is documented.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` passes.
- [ ] `bun run test:integration:v2` passes.

## Documentation updates

- `v2/docs/daemon-host.md` — conditional `idle_output_timeout` retryability, `nextAction`, and alignment with `wait.resumable`.
- `v2/docs/v1-behaviors.md` — daemon list/wait projection for committed-progress idle timeouts.
- `v2/docs/write-behavior.md` — remove interim-limbo stop-only daemon admission deferral.
- `v2/docs/workflow-runner.md` — remove interim-limbo stop-only daemon admission deferral.
