# Skip shrink contract test on no file changes

Skip the post-shrink contract `bun run test` re-run when the agent shrink
produced no surviving file changes. When changes exist, the existing guards
(AC regression, no deleted scoped `*.test.ts`, `bun run test`) are unchanged.

## Problem

After agent shrink, `runPatchShrinkPhase` re-runs the contract `bun run test`
even when shrink produced no surviving edits — a wasted full test run that
gates nothing. The existing agent path already short-circuits on an empty
worktree in some cases, but the contract re-run is not consistently skipped on
a no-change result.

## Decisions

- No surviving file changes from agent shrink skips the `bun run test` contract re-run. Rules out always re-running `bun run test` after a no-op shrink.
- "No surviving file changes" means the run-scoped diff is empty after the agent returns (and after any scope-guard revert). Rules out keying the skip on whether the agent claimed an edit rather than on the actual tree.
- When changes do survive, the AC-regression and no-deleted-scoped-test guards and the `bun run test` re-run apply unchanged. Rules out dropping contract validation along with the skip.

## Task checklist

- [ ] In `runPatchShrinkPhase`, after the agent invocation and scope-guard revert, detect an empty run-scoped diff and skip the contract `bun run test` re-run for that case.
- [ ] Leave the change-present path (AC regression, no deleted scoped `*.test.ts`, `bun run test`, commit) unchanged.
- [ ] Docs per below.

## Acceptance criteria

- [x] With `modes.patch.shrink: "agent"`, when the shrink agent produces no surviving file changes, the contract `bun run test` is not run and no `shrink:` commit is made.
- [x] With `modes.patch.shrink: "agent"`, when the shrink agent produces surviving file changes, the AC-regression and deleted-scoped-test guards still apply, `bun run test` runs, and a contract miss discards all shrink changes without elevating the run exit code.
- [x] `bun run typecheck` and `bun run test` pass.

## Documentation updates

- `v1/docs/run-loop.md`: document that a no-change agent shrink skips the contract `bun run test` re-run; a changed tree retains the AC-regression and scoped-test guards.
- `v2/docs/v1-behaviors.md`: update the post-completion shrink section with the contract-test skip on no file changes.
