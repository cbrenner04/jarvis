# Run full gates as fix-commit-ready

## Problem

`runReadyAndCommit` still commits dirty output after a green ready gate. Now that built-in `ready` is strict verification and `fix` is the autofix entrypoint, full gates need to run autofix first, commit that output, then verify the exact committed tree.

## Scope

Change `runReadyAndCommit` and its patch/plan call sites through the shared helper. Keep `fast` tier carrier behavior unchanged. Do not redefine the `fix` or strict `ready` scripts.

## Decisions

- Full-tier gates run `bun run fix` before `ready` - rules out post-ready dirty-output commits.
- Fix output is committed and pushed before `ready` - rules out a green gate on a tree CI will not see.
- `fast` tier skips fix and fix commits - rules out mutating recorded-green reuse checks.
- Fix-commit failure, push failure, or dirty porcelain after the fix commit aborts before any `gh pr ready` - rules out marking ready after an unverified or unpushed autofix.
- The existing per-project `readyCommand` remains the verification command after the fix commit - rules out using custom ready commands as the autofix entrypoint.

## Tasks

- Replace the post-ready dirty-tree commit path with a pre-ready `bun run fix` path for `full` gates.
- Commit and push any fix output before invoking `ready`.
- Keep `fast` tier behavior and recorded-green tier selection unchanged.
- Update patch, plan, and triage ready-transition tests that currently expect `ready` to dirty the tree.
- Update durable docs for the new fix -> commit -> ready order.

## Acceptance criteria

- [ ] On a full-tier gate with fixable changes, Jarvis runs `bun run fix`, commits and pushes the fix output, then runs the verification gate against the committed tree.
- [ ] If the fix command, fix commit, fix push, or post-commit clean-worktree check fails, Jarvis does not run the verification gate and does not call `gh pr ready`.
- [ ] A green full-tier verification gate never commits dirty output after `ready` returns.
- [ ] Fast-tier gates do not run `bun run fix`, do not commit fix output, and keep existing recorded-green carrier semantics.
- [ ] Patch completion, review baseline/final, shrink pre-gate, `maybeMarkReady`, plan-mode ready transition, and triage ready/merge transitions use the same full-tier ordering through `runReadyAndCommit`.
- [ ] Per-project `readyCommand` overrides still replace the verification command and receive `JARVIS_READY_TIER`; they do not replace `bun run fix`.
- [ ] `run.test.ts`, `ready-gate.test.ts`, `modes/patch/pr.sandbox-unrunnable.test.ts`, `modes/plan/pr.sandbox-unrunnable.test.ts`, and `triage-command.test.ts` cover the new order and failure branches.
- [ ] `v1/docs/operator-runbook.md` describes fix -> commit -> strict ready and removes the hand-merge autofix caveat.
- [ ] `v1/docs/worktrees-and-commits.md` describes completion readiness without a post-ready dirty-output commit.
- [ ] `v2/docs/v1-behaviors.md` records the new completion-gate, post-completion gate, and review-baseline behavior.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test` passes.

## Documentation updates

- `v1/docs/operator-runbook.md` - operator flow and hand-merge caveat.
- `v1/docs/worktrees-and-commits.md` - completion readiness and dirty-output commit semantics.
- `v2/docs/v1-behaviors.md` - authoritative v1 completion/readiness behavior.
