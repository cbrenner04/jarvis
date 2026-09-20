# Unlanded-commits refusal names the continue path first

`staleResetUnlandedCommitsGateReason` currently ends with "hand-finish the branch or run `jarvis cleanup --abandon <branch>` before retiring the workspace". When the refusal is reached on a lane that could have continued, the cheapest recovery — drop the reset flag and let the lane continue on its existing worktree — is not named. Name it first, and only there.

## Decisions

- The exported reason builder takes an optional continue-path-available input; the clause is added only when the caller passes it true, defaulting to absent — rules out always appending, which would advertise continuation on dirty-tree, zero-commit, and disposable-branch refusals where continuation is never attempted.
- Only the flag-forced retirement call site (clean, non-disposable, base-descended, commits ahead) passes true.
- Only the unlanded-commits reason gets the clause; `staleResetUnreachableWorktreeHeadGateReason` keeps the current recovery text — rules out editing the shared recovery string, which would advertise continuation for a `HEAD` the branch cannot reach and which continuation refuses.
- Ordering is continue path, then hand-finish, then `--abandon`.

## Acceptance criteria

- [ ] A test calls `staleResetUnlandedCommitsGateReason` with the continue-path input and asserts the text names re-running without `--reset-despite-continuable` to continue, before hand-finish and before `jarvis cleanup --abandon`; it fails against the pre-fix builder.
- [ ] A test calls `staleResetUnlandedCommitsGateReason` without the input and asserts the pre-fix text, with no continue-path mention.
- [ ] A test asserts the dirty-lane and disposable-branch unlanded-commits refusals do not advertise the continue path; it fails if the clause is appended unconditionally.
- [ ] A test drives `jarvis run workflow implement --reset-despite-continuable` on a lane with unlanded non-staging commits and asserts the refusal names the continue path before hand-finish and `jarvis cleanup --abandon`.
- [ ] A test asserts `staleResetUnreachableWorktreeHeadGateReason` text is unchanged.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Incomplete re-run preflight gates — quote the recovery ordering in the unlanded-commits refusal and that the continue-path clause appears only on flag-forced retirement.
- `v2/docs/v1-behaviors.md` — record the changed unlanded-commits refusal text.
