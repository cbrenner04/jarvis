# 01 - Undecidable missing token stays resumable

## Problem

`terminalMapping` (`v2/src/execution/write-loop.ts:582`) maps `invalid_token` to
`{ kind: "invocation_failure", runStatus: "failed" }`, so the loop finishes
`resumable: false` and `committedResult` returns that failure forever after. Even
when subspec 00 cannot decide the outcome, whatever the agent wrote is on disk in
the worktree; recording the run `failed` strands it and forces a paid redraft.

## Decisions

- `invalid_token` commits its boundary with a resumable run status (attempt `outcomeKind` stays `invalid_token`) and the loop finishes `resumable: true`. Rules out `failed`, which makes `committedResult` short-circuit every later resume.
- The loop stops on `invalid_token` rather than iterating again like `progress` — a mis-formatted terminal line is usually deterministic, and retrying pays for a whole draft per iteration.
- Loop result `kind` stays `invocation_failure` (`WriteLoopOutcomeKind` gains no member) — only `resumable` and the persisted status change. Rules out a new outcome kind rippling through daemon, TUI, and CLI mappings for no operator-visible gain.
- Operator error for attempt `outcomeKind: "invalid_token"` becomes retryable with next action `resume` (`v2/src/daemon/run-operator-error.ts`), matching the new resumability.
- `invalid_token_detail` logging is unchanged.

## Acceptance criteria

- [x] A write-loop iteration ending `invalid_token` finishes `resumable: true` and leaves the run in a resumable status (not `failed`); the worktree artifacts are untouched.
- [x] Re-invoking that run resumes it with a fresh attempt over the existing worktree instead of returning the previously recorded terminal failure.
- [x] `jarvis run` operator error for an `invalid_token` run reports `retryable: true` / `nextAction: "resume"`.
- [ ] A reproduced `plan` / `plan-reviewed-light` run whose spec tree exists on disk ends `complete` (subspec 00) — and, if the contract is unsatisfied, `resumable: true` rather than `failed`. (Manual)

## Documentation updates

- `v2/docs/write-behavior.md` — `invalid_token` is resumable; correct the terminal-outcome and `invocation_failure` JSON sections.
- `v2/docs/daemon-host.md` — operator-error mapping for `invalid_token`.
- `v2/docs/operator-runbook.md` — delete the `invalid_token — your work is on disk, go get it` recovery section and drop the `plan` / `plan-reviewed*` row's `invalid_token` failure from the dogfood table.
