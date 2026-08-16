---
name: pipeline-stage-recoverable-after-blocker
---

# A blocked pipeline stage is unrecoverable, so the first blocker kills the pipeline

## Problem

A pipeline stage that blocks cannot be fixed and continued by the operator — and because blockers are inevitable (plan-draft contract rejections, review-appended blockers), a single blocked stage permanently strands its branch. On a fan-out with dependent branches gated by sequential `approve-intent`, one dead branch derails the operator's whole ordered-landing plan. **Without an in-place stage-recovery mechanism, pipelines are dead in the water: the first inevitable blocker ends the run with no way forward.**

Observed 2026-08-16 (pipeline `22041e31`, branch `configure-pipeline-supersede-policy`): the plan stage settled `contract_miss` — the plan-draft contract rejected subspec `00`'s **out-of-union `## Decisions` bullet** — with `resumable: false`, `nextAction: inspect_spec`. There is no operator path to fix that one bullet and continue:

- The run is `resumable: false`, so `jarvis pipeline resume` refuses (`pipeline_not_resumable`) or replays the *drafting* step from scratch, discarding the operator's edit and reproducing the same bad draft.
- Editing the staged `.jarvis-plan-stage/` draft does not survive, because a re-run re-drafts from the ready-intent rather than re-validating the operator-corrected stage.
- The same pattern on branch `distinguish-jarvis-commit-steps` caused a worse failure: the operator fixed the draft, committed, and resumed; the resume re-ran, failed again, and **committed `.jarvis-plan-stage/` onto `main`** (a botched publication) — because the resume neither continued the fix nor recognized the run as non-continuable.

## Operator model this must support (stated by the operator)

Fan-out handles **dependent** intents; the operator controls landing order via sequential `approve-intent` gates (approve each branch as its predecessor lands). A branch blocking on an unmet prerequisite is a *recoverable wait*, not a fatal error. A stage that blocks on a fixable draft/spec/review issue must be **fixable-and-continuable in place**, exactly like an implement that blocks after passing review — the operator does not re-run the whole thing.

## Decisions

- A blocked stage is **operator-recoverable per branch**: after the operator edits the staged artifact in that branch's worktree (correct the contract-flagged draft, remove a review/agent `## Blocker`), an operator command re-runs **that stage** by **re-validating the operator-edited stage and continuing** (to review/publish) — it does **not** re-draft from the ready-intent (so the operator's fix is preserved) and does **not** touch sibling branches. Rules out the current re-draft-from-scratch-or-nothing behavior.
- `resumable: false` on a `contract_miss`/blocked stage must **not** mean unrecoverable. Provide an explicit operator continue/re-run path for these states; the "non-resumable" classification may still forbid a *silent* auto-resume, but the operator must have a deliberate recovery verb. Rules out the current terminal dead-end.
- Branch-scoped, building on `branch-scoped-pipeline-resume`: recovery targets one `branchKey` and never re-runs or disturbs sibling branches or their gates.
- The recovery re-run must **never** commit `.jarvis-plan-stage/` (or any staging sidecar) to a real branch — publication must move the corrected stage to `v2/spec/` and consume the ready-intent, exactly as a clean publication does. Rules out the observed staging-dir leak.
- A genuinely unfixable block (the operator cannot correct it) still terminates the branch with a clear reason; recovery is opt-in, not automatic. Rules out masking real dead-ends.

## Acceptance criteria

- [ ] A plan stage blocked `contract_miss` (`resumable: false`) whose operator has corrected the staged draft can be continued by an operator command that re-validates the edited stage and publishes it, advancing the branch — pinned by a daemon test reproducing the `22041e31` out-of-union-Decisions-bullet case.
- [ ] The recovery re-runs only the named branch's stage; sibling branches and their `approve-intent` gates are untouched, pinned by a test.
- [ ] The recovery preserves the operator's staged edits (does not re-draft from the ready-intent), pinned by a test.
- [ ] The recovery publishes the corrected stage to `v2/spec/` and consumes the ready-intent, never committing `.jarvis-plan-stage/` to a branch, pinned by a test.
- [ ] A block the operator has not corrected still terminates with a clear reason (no silent success), pinned by a test.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — how to recover a blocked pipeline stage in place: fix the staged artifact in the branch worktree, then run the recovery verb; note it is branch-scoped and preserves the fix. Cross-link `branch-scoped-pipeline-resume`.
- `v2/docs/workflow-runner.md` / `v2/docs/daemon-host.md` — the stage-recovery contract: re-validate-and-continue vs re-draft, the `resumable:false`-is-still-recoverable rule, and the no-staging-dir-leak guarantee.
