# 00 - Recover plan PR readiness by branch PR state

## Problem

`maybeMarkPlanPrReady(...)` currently asks only whether an open PR exists for
the plan branch. Once that binary check returns a PR number, the helper always
runs `bun run ready` and then `gh pr ready <branch>`.

That contract is too weak for committed plan resume recovery:

- a completed plan branch whose open PR is still draft should retry the ready
  gate and transition on a later successful committed `jarvis plan --resume`
  run;
- a completed plan branch whose open PR is already ready should not rerun the
  ready gate or surface a warning from `gh pr ready`;
- a completed plan branch with no open PR should continue to no-op silently;
- a rerun whose ready gate fails must preserve the current boundary: emit the
  existing warning and leave the PR draft.

## Decisions

- Add an explicit branch-scoped open-PR-state lookup seam for plan readiness.
  The implementation can use an enum or small object, but tests must be able to
  distinguish `none`, `draft`, and `ready` without inferring state from shell
  output.
- Limit the behavior change to committed plan mode's success path. Jarvis still
  attempts readiness only after plan mode itself completes successfully in the
  `commit: true` flow, including successful committed resume runs.
- Treat `ready` as a true no-op for the whole helper. Do not run `bun run ready`
  and do not call `gh pr ready` when the branch already has an open ready PR.
- Preserve the existing warn-and-continue boundary in
  `safeMarkPlanPrReady(...)`. Draft-PR recovery failures remain visible as
  `warning: could not mark PR ready for review: ...`, while `none` and `ready`
  states produce no warning.
- Keep closed or merged PRs out of scope for this work. The readiness helper
  only consults the branch's open PR state and otherwise behaves as if no open
  PR exists.

## Tasks

- [ ] Replace the plan-mode readiness seam in `src/modes/plan/pr.ts` so
      `maybeMarkPlanPrReady(...)` branches on explicit open-PR state rather
      than `number | null`.
- [ ] Update the default branch-scoped PR lookup used by plan readiness so it
      can distinguish open draft PRs from open ready PRs without coupling the
      contract to GitHub CLI error text.
- [ ] Keep the default open-draft path behavior unchanged: run `bun run ready`
      first, then `gh pr ready`, and surface `bun run ready` failures with the
      current multi-line error formatting.
- [ ] Leave `safeMarkPlanPrReady(...)` in `src/commands/plan.ts` as the
      best-effort wrapper, but adapt its test seam types to the richer open-PR
      state contract.
- [ ] Reshape `test/modes/plan/pr.test.ts` around stateful cases instead of the
      current binary "PR exists" contract.
- [ ] Add or update command-level coverage in `test/plan-command.test.ts` only
      if needed to prove the successful committed plan completion path still
      invokes the helper and still warns only on real recovery failures.

## Documentation updates

- [ ] Update any inline comments or docstrings near the plan readiness helper so
      they describe the new `none` / `draft` / `ready` behavior accurately.

## Acceptance criteria

- [ ] A later successful committed `jarvis plan --resume ...` run against a
      branch with an open draft PR still runs the ready gate and flips the PR
      to ready.
- [ ] A later successful committed `jarvis plan --resume ...` run against a
      branch with an open ready PR skips both `bun run ready` and `gh pr ready`
      and emits no readiness warning.
- [ ] A branch with no open PR remains a silent no-op for the plan readiness
      helper.
- [ ] If `bun run ready` fails while recovering an open draft PR, the helper
      still surfaces the failure through
      `warning: could not mark PR ready for review: ...` and does not force the
      PR ready.
- [ ] Unit tests in `test/modes/plan/pr.test.ts` cover the `none`, `draft`, and
      `ready` states explicitly rather than inferring behavior from CLI stderr
      text.
