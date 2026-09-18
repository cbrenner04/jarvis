# Entirely out-of-diff refusal settles non-resumable

## Problem

An out-of-diff fence refusal settles retryable `completion_commit_failed` (`resumable: true`, runbook advises `jarvis run resume`); when the only valid fix is out-of-diff, resume never succeeds (#3040 retryable-forever wedge). Depends on 00.

## Decisions

- When every repair candidate is refused by the out-of-diff fence, settle `failed` with `resumable: false` and no `resume` in `list`/`wait` `nextAction` — rules out keeping it retryable; the fence stays absolute (no bypass).
- The operator incident and terminal failure detail name the refused paths — the out-of-diff fix becomes an operator decision.
- Keep terminal cause `completion_commit_failed`, distinguished by `resumable: false` plus refused-path evidence — rules out a new outcome kind rippling through every outcome switch. Deferred to first consumer: a dedicated outcome kind — pin when a caller needs to branch on it.

## Acceptance criteria

- [ ] A new `v2/src/execution/write-loop.test.ts` test drives a real repair pass through `validateReadyGateRepairCompletion` (no injected fence stub) whose edits are all outside the run diff and spec tree. It asserts the run settles `resumable: false`, that `nextAction` is not `resume`, and that an operator incident (`v2/src/daemon/operator-incidents.ts`) names the refused paths. It fails against the pre-fix retryable settlement.
- [ ] A new test in `v2/src/daemon/daemon-resume.test.ts` pins that resume admission rejects a `completion_commit_failed` row with `resumable: false`.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — completion-failure recovery: entirely out-of-diff refusal settles non-resumable; fix out-of-diff paths by hand, do not resume.
- `v2/docs/v1-behaviors.md` — record the non-resumable settlement.
