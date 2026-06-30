# Auto-integrate base on conflict-free behind-base at patch-run completion

## Problem

Patch-run completion can reach the final draft→ready flip with all criteria checked
yet block because the branch is behind its PR base (`ready flip blocked: branch …
does not contain base …; PR stays draft`). Conflict-free integration is common when
sibling PRs merge during a long run; the operator today hand-runs
Integration-merge-then-retest. Post-block, fix+ready never runs on the integrated
tree, so post-actuator lint dirt can reach CI (observed PR #773).

## Decisions

- Shared auto-integrate helper in `v1/src/git/` (e.g. `auto-integrate-base.ts`) — rules out duplicating merge/abort/reset logic in `pr.ts` and `review.ts`.
- `maybeMarkReady` opts `autoIntegrateBase?: boolean` default `false`; only `patch-complete` passes `true` — rules out per-iteration early-ready and `review-incomplete` auto-merge.
- Skip `iteration.ts` `maybeMarkReady` when completion-pipeline will run `patch-complete` (no-shrink/no-review path) — rules out double behind-base stderr and double auto-integrate on the same completion.
- Enabled sites: completion-pipeline `patch-complete` `maybeMarkReady` and review-final behind-base branch — rules out `review-incomplete` (exit-11 recovery; intent targets nominal final flip).
- Behind-base at an enabled site: `git merge --no-edit origin/<base>` in the run worktree after the existing fetch — rules out `--no-commit` trial merge or a new subcommand.
- Pre-merge porcelain must be clean; dirty tree → immediate `writeReadyFlipBlocked`, no merge — rules out lossy `reset --hard` on actuator residue.
- Record pre-merge `HEAD` before merge; on conflict call `git merge --abort` — rules out leaving conflict markers in the worktree.
- On conflict-free merge, force `full` ready gate on the merged tree, then always `pushCurrent` (even when gate made no fix/post-verify commits), then `gh pr ready` — rules out leaving merge commits local and rules out flipping without re-gating.
- On merge conflict or post-merge gate failure: restore pre-merge `HEAD` locally (`git merge --abort` when in-progress; else `git reset --hard` to recorded sha), emit today's `writeReadyFlipBlocked` stderr, leave PR draft, do not throw; do not force-push remote back if integration was already pushed — rules out auto-resolving conflicts, leaving an integrated-but-ungated branch, and reverting remote after partial push.
- `gh pr ready` failure after successful integrate+push: warn and return (draft PR; integrated branch may be on remote) — rules out throwing after a successful push.
- Enabled paths intentionally merge then gate (reverses guard-before-gate fail-fast at those sites) — rules out blocking before merge attempt at final completion.
- `autoIntegrateBase: false` (default) preserves today's immediate block without merge attempt — rules out changing per-iteration early-ready, `review-incomplete`, or other implicit call sites.
- Triage `--mark-ready` and plan-mode draft→ready stay unchanged — rules out widening auto-integrate to manual finalize paths.
- Deferred to first consumer: merge commit message/trailer — pin when helper is drafted.

## Task checklist

- [x] Add `v1/src/git/` auto-integrate helper: merge, gate, push, ready flip, abort/reset on failure; injectable git/gate/push seams for tests.
- [x] Wire helper into `maybeMarkReady` behind-base branch when `autoIntegrateBase: true`.
- [x] Pass `autoIntegrateBase: true` from completion-pipeline `patch-complete` only; remove duplicate `iteration.ts` `maybeMarkReady` on that path.
- [x] Wire the same helper into review-final behind-base branch before gate/ready.
- [x] Tests per acceptance criteria (new + preservation anchors).
- [x] Documentation updates per section below.

## Acceptance criteria

- [x] `v1/test/git/auto-integrate-base.test.ts` `conflict-free behind merges, full gates, pushes, and marks ready` — behind-base at enabled site with clean porcelain and conflict-free `origin/<base>` merge.
- [x] `v1/test/git/auto-integrate-base.test.ts` `merge conflict aborts and blocks ready` — abort merge, `writeReadyFlipBlocked` stderr, no `gh pr ready`.
- [x] `v1/test/git/auto-integrate-base.test.ts` `post-merge gate failure resets local tree and blocks ready` — restore pre-merge `HEAD`, same blocked stderr, no `gh pr ready`.
- [x] `v1/test/git/auto-integrate-base.test.ts` `pushes merge commit when gate is clean` — no fix/post-verify commits from gate; `pushCurrent` still runs before ready flip.
- [x] `v1/test/git/auto-integrate-base.test.ts` `dirty pre-merge porcelain blocks without merge` — immediate blocked stderr, no merge attempt.
- [x] `v1/test/git/auto-integrate-base.test.ts` `gh pr ready failure after integrate warns without throwing` — draft PR; push may have succeeded.
- [x] `v1/test/modes/patch/pr.sandbox-unrunnable.test.ts` `autoIntegrateBase merges behind base on conflict-free completion` — `maybeMarkReady` with `autoIntegrateBase: true` success path.
- [x] `v1/test/modes/patch/pr.sandbox-unrunnable.test.ts` `blocks ready flip when branch is behind base` stays green (`autoIntegrateBase` default).
- [x] `v1/test/modes/patch/review.sandbox-unrunnable.test.ts` `review final auto-integrates behind base on conflict-free merge` — replaces `review final leaves PR draft when branch is behind base` success coverage.
- [x] `v1/test/modes/patch/review.sandbox-unrunnable.test.ts` `review final aborts merge conflict and blocks ready` — same blocked contract as helper.
- [x] `v1/test/modes/patch/review.sandbox-unrunnable.test.ts` `review final resets on post-merge gate failure and blocks ready` — same blocked contract as helper.
- [x] `v1/test/run.test.ts` `no-review path emits at most one behind-base auto-integrate` — no-shrink/no-review completion does not double-call on behind base.
- [x] `v1/test/git/auto-integrate-base.test.ts` `maybeMarkReady and review-final share behind-base outcomes` — cross-path parity on success, conflict abort, and gate-failure reset.
- [x] `v1/test/triage-command.test.ts` behind-base `--mark-ready` refusal tests stay green.
- [x] `v1/test/modes/plan/pr.sandbox-unrunnable.test.ts` `blocks ready flip when branch is behind base` stays green.

## Documentation updates

- [x] `v1/docs/operator-runbook.md`: conflict-free behind-base auto-integrates at patch-run completion; Integration-merge-then-retest remains for conflicts; manual `--no-commit` trial merge unchanged (harness auto-path commits on conflict-free merge); remove concurrency caveat referencing this seed; align behind-base finalize wording across sections.
- [x] `v1/docs/run-loop.md`: at `patch-complete` and review-final, behind-base intentionally merges then runs post-merge `full` gate (reverses guard-before-gate fail-fast at those sites); note push-before-ready ordering.
- [x] `v2/docs/v1-behaviors.md`: record behind-base auto-merge + post-merge `full` gate at `patch-complete` and review-final; state guard-before-gate reversal at those sites; note triage/plan unchanged.
