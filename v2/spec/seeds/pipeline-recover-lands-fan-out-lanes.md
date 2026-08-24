---
name: pipeline-recover-lands-fan-out-lanes
---

# `pipeline recover` refuses fan-out lanes, so a hand-corrected lane plan stage has no landing path

## Problem

`jarvis pipeline recover <id> <branch-key>` refuses on any fan-out lane: `stage_resolution_failed: pipeline-stage-recovery: fan-out resolution is not recoverable`. `resolveBlockedPlanStageRecoveryTarget` (`v2/src/daemon/pipeline-stage-recovery.ts:95`) already passes `branchKey` and `splitPosition` into `resolveStage`, but a plan stage after a splitting intent always resolves as a fan-out resolution, and line 153 rejects `isFanOutStageResolution(resolution)` outright — recovery only works for single-branch pipelines, even though the verb takes a branch key.

So on a multi-lane pipeline a plan `contract_miss`/blocked outcome that needs a hand edit is terminal:

- `pipeline recover <id> <lane>` refuses (this bug).
- Branch-scoped `pipeline resume <id> <lane>` **redrafts** — it redispatches the plan write step and discards the operator's staged correction. When the failure is deterministic (e.g. the JS-only keystone matcher, `keystone-test-file-matching-is-language-neutral` / #2982), resume is a loop, not a fix.

The operator must abandon the pipeline, copy `.jarvis-plan-stage/` onto `main` by hand, and continue with standalone presets — losing the stacked-PR choreography and `terminalAction`. Worst on the `fast` pipeline, which has no per-stage review to repair a draft in-flight, so hand-correct-then-recover is its only repair story — exactly the path that refuses.

Observed 2026-08-24, `cbrenner04/chess-mvp-yolo` `fast` pipeline `749a0b3a`, lane `ios-app-project-and-make-build-test` blocked `contract_miss`, staged tree hand-corrected, `pipeline recover` refused. Issue #2984.

## Decisions

- Support branch-scoped recovery on fan-out lanes: when `branchKey` names one lane, narrow the fan-out resolution to that lane's single-branch steps — the same narrowing ordinary post-split branch dispatch already performs — and land it, instead of rejecting the whole resolution class at line 153. Rules out the current blanket `isFanOutStageResolution` refusal for a branch-scoped call.
- Recovery still only touches the named lane's own rows; sibling lanes and their gates are untouched (preserve current single-branch recover semantics). Rules out any cross-lane mutation.
- Keep every existing recover guard for the lane: refuse when the lane has no failed plan stage, the stage is not `plan`, is unlinked, or carries an operator `## Blocker`. Rules out loosening the safety checks.
- The unscoped (`branchKey` omitted) recover call keeps refusing on a fan-out pipeline (it cannot pick a lane). Rules out guessing a lane.

## Acceptance criteria

- [ ] `resolveBlockedPlanStageRecoveryTarget` on a fan-out pipeline with `branchKey` naming a failed plan lane resolves that lane's single-branch recovery steps (leading write step dropped, plan-tree review landing found) instead of returning `stage_resolution_failed: … fan-out resolution is not recoverable` — pinned by a test seeding a split pipeline with one failed lane plan stage (fails against the current line-153 refusal).
- [ ] `jarvis pipeline recover <id> <lane>` on such a pipeline admits (`kind: "admitted"`) and the lane's hand-corrected staged tree lands without redrafting — pinned by a daemon/recovery test.
- [ ] Recovery of one lane leaves sibling lanes' rows, gates, and stages untouched — pinned by a test asserting sibling records are unchanged.
- [ ] Every existing recover refusal (`no_failed_stage`, `stage_not_plan`, `stage_not_linked`, `operator_blocker`) still fires for the named lane — pinned by tests.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Pipeline recover — recover now targets a fan-out lane by branch key; drop any note that it cannot.
- `v2/docs/daemon-host.md` § Branch-scoped blocked plan-stage recovery — fan-out lane narrowing behavior.
