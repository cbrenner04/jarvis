# Daemon list/wait projection

## Problem

`jarvis run list` and `jarvis run wait` compose operator errors through
`composeRunOperatorError` from terminal `loop_finished` records. After
[01 - Write-loop settlements](./01-write-loop-settlements.md), durable rows carry dirty-`no-work`
refusals, conditionally resumable `iteration_timeout` settlements, and completion inventories —
but daemon mapping still projects `iteration_timeout` as `nextAction: "stop"` and does not
surface the new fields. Operators reading CLI rows see false `completed` or opaque timeouts.

## Decision ledger

- `run list` / `run wait` project dirty-`no-work` refusal, resumable `iteration_timeout`
  `nextAction`, and completion inventory from the same durable `loop_finished` fields the write
  loop wrote — rules out CLI rows still reading `completed` and rules out message-only diagnostics.
- `publicationFailure`, `completionCommitError`, and other existing operator-error fields stay
  when present on the same terminal row — rules out dropping structured evidence.
- `iteration_timeout` with `resumable: true` maps to `nextAction: "resume"` and updated recovery
  copy; `resumable: false` keeps `nextAction: "stop"` — rules out resume admission contradicting
  the durable row.

## Prerequisites

- [00 - Preflight gates](./00-preflight-gates.md) and [01 - Write-loop settlements](./01-write-loop-settlements.md) merged — durable `loop_finished` rows exist for the behaviors under test.
- `composeRunOperatorError` maps terminal `loop_finished` records to `run list` / `run wait` operator errors.

## Task checklist

- Extend `mapFromLoopFinished` (and `RUN_OPERATOR_ERROR_RECOVERY`) for dirty-`no-work` terminal rows, resumable `iteration_timeout`, and `completedSubspecPaths` / `remainingSubspecPaths` projection on composed `RunOperatorError`.
- Add `daemon-wait-run-completion.test.ts` list/wait fixtures for dirty-`no-work`, both `iteration_timeout` resumability cases, and completion inventory; assert coexistence with `publicationFailure` when both are present.
- Update `daemon-host.md` and `v1-behaviors.md`.

## Acceptance criteria

- [ ] `daemon-wait-run-completion.test.ts` `list and wait project dirty no-work refusal with uncommitted paths` asserts non-`completed` row `status`, operator `error` naming uncommitted paths, and `nextAction` other than success semantics; fails against current daemon mapping.
- [ ] `daemon-wait-run-completion.test.ts` `list and wait project resumable iteration_timeout as resume` and `list and wait project non-resumable iteration_timeout as stop` assert `error.nextAction` and `resumable` for terminal `iteration_timeout` rows with `resumable: true` vs `false`; fail against current mapping.
- [ ] `daemon-wait-run-completion.test.ts` `list and wait carry iteration_timeout completion inventory` asserts `error.completedSubspecPaths` and `error.remainingSubspecPaths` match the terminal `loop_finished` lists for a one-complete one-incomplete fixture; fails against current mapping.
- [ ] `daemon-wait-run-completion.test.ts` `list and wait carry iteration_timeout completion inventory` asserts `error.publicationFailure` survives alongside inventory when both are present on the terminal row.
- [ ] `run-operator-error.test.ts` unit coverage for new `mapFromLoopFinished` branches stays green with the integration fixtures.
- [ ] `bun run typecheck`, `bun run check`, `bun run lint:md`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — document completion-honesty operator-error fields on `list`/`wait` (`completedSubspecPaths`, `remainingSubspecPaths`, dirty-`no-work` reason/detail, resumable `iteration_timeout` `nextAction`) and coexistence with `publicationFailure` / `completionCommitError`.
- `v2/docs/v1-behaviors.md` — record daemon projection of dirty-`no-work` refusal, resumable `iteration_timeout`, and completion inventory.
