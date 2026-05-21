# 00 - Recover plan PR readiness by branch PR state

## Problem

Committed plan mode already tries to flip the branch PR from draft to ready
when a plan run finishes successfully. The gap is recovery when that transition
did not happen earlier and the user later runs a successful committed
`jarvis plan --resume ...`.

Today `maybeMarkPlanPrReady(...)` only distinguishes "open PR exists" from "no
open PR". Once it sees any open PR for the branch, it reruns `bun run ready`
and then `gh pr ready <branch>`. That is too coarse for the recovery behavior
this tree needs:

- an open draft PR should retry the ready gate and transition to ready;
- an open ready PR should be a true no-op;
- no open PR should remain a silent no-op;
- a failed ready gate should still leave the PR draft and surface the existing
  warning through the command-level wrapper.

## Decisions

- Scope this change to the existing committed plan success path. A successful
  committed `jarvis plan --resume ...` run is the recovery trigger; incomplete,
  blocked, or failed plan runs do not attempt PR readiness work.
- Add an explicit open-PR state lookup for the current plan branch so the
  readiness helper can distinguish `none`, `draft`, and `ready` before it
  decides whether to run any gate or GitHub transition command. The lookup
  contract should expose the PR identity together with that state so the
  helper does not have to fall back to a second binary existence check.
- Treat `ready` as a no-op for the entire helper. Do not run `bun run ready`
  and do not call `gh pr ready` when the branch already has an open ready PR.
- Preserve the current warn-and-continue boundary in
  `safeMarkPlanPrReady(...)`: failures while recovering an open draft PR still
  surface as `warning: could not mark PR ready for review: ...`.
- Keep the lookup limited to open PRs for the branch. Closed or merged PRs
  remain out of scope and behave the same as "no open PR" for this path.

## Task Checklist

- [ ] Replace the binary plan-mode PR lookup in `src/modes/plan/pr.ts` with a
      branch-scoped open-PR state lookup that exposes `none`, `draft`, and
      `ready` directly to `maybeMarkPlanPrReady(...)`, along with the open PR
      identity needed for the draft-to-ready transition.
- [ ] Update `maybeMarkPlanPrReady(...)` so it only runs `bun run ready` and
  `gh pr ready` for the `draft` state, and skips the entire readiness flow
  for `none` and `ready`.
- [ ] Preserve the current draft recovery order and failure behavior:
      `bun run ready` runs before `gh pr ready`, multi-line ready-gate failures
      keep their current formatting, and `gh pr ready` is not called after a
      failed gate.
- [ ] Keep `safeMarkPlanPrReady(...)` in `src/commands/plan.ts` as the
      best-effort wrapper, updating only the seam types and assertions needed
      for the richer PR-state contract.
- [ ] Rewrite `test/modes/plan/pr.test.ts` around explicit `none`, `draft`, and
      `ready` cases instead of the current binary "PR exists" contract.
- [ ] Update `test/plan-command.test.ts` only where needed to prove the command
      still invokes the helper only on the successful committed completion path
      and only warns on real draft-recovery failures.

## Documentation updates

- [ ] Update inline comments or docstrings near the plan readiness helper so
      they describe the `none` / `draft` / `ready` behavior and the committed
      resume recovery trigger accurately.

## Acceptance criteria

- [x] On a later successful committed `jarvis plan --resume ...` run, an open
  draft PR for the plan branch still runs the ready gate and is flipped to
  ready.
- [x] On a later successful committed `jarvis plan --resume ...` run, an open
      ready PR for the plan branch skips both `bun run ready` and `gh pr ready`
      and emits no readiness warning.
- [x] If the plan branch has no open PR, the plan readiness helper remains a
      silent no-op.
- [x] If `bun run ready` fails while recovering an open draft PR, the PR
  remains draft and the failure still surfaces through
  `warning: could not mark PR ready for review: ...`.
- [x] Unit tests in `test/modes/plan/pr.test.ts` assert the `none`, `draft`,
  and `ready` states explicitly rather than inferring state from GitHub CLI
  stderr text.
- [x] Command-level tests still prove the recovery helper only runs after a
  successful committed plan completion path, not after incomplete or failed
  plan runs.
