---
name: harness-commits-stay-in-run-scope
---

# Harness commits stay in the run's scope

## Problem

Every harness commit path (write completion/checkpoint, shrink, resume recovery, ready-gate repair) goes through `createCompletionCommitter` (`v2/src/execution/completion-commit.ts`), which stages `git add -A -- .` minus a few harness sidecars. Whatever the worktree holds is committed, including files the run never touched and files regressed to older `main` content. The ready-gate repair fence exists, but for non-test gates `resolveAttributableRepairAllowset` (`v2/src/execution/ready-finalize.ts`) builds the allowset from the failing gate output's attributable paths alone, not intersected with the run diff, so a pre-existing failure in an unrelated file authorizes editing that file.

## Evidence

- `d39f5071c` (backfill lane, `Jarvis-Step: shrink`): committed 13 files of #4268's supersede-policy work; net-zero against `main`, noise in the lane diff.
- `bf1e5cbc6` (failure-usage lane, `Jarvis-Step: write`): swept ~30 stale-`main` files and would have resurrected 3 deleted seeds; PR #4286 closed, rebuilt clean as #4301.
- `658c18963` (review-roles plan lane, `Jarvis-Step: ready-gate`, cursor): edited out-of-scope `v2/src/daemon/daemon-retire-cause.test.ts` and broke it; the fence passed it (likely the attributable-paths hole above; confirm from the gate output); hand-reverted in #4278.

## Decisions

- One scope check in the committer, applied on every harness commit path: staged paths must be in the run's diff against its merge base, its spec tree, or a test co-located with a path in that diff. Out-of-scope paths are reverted to HEAD and named in a `commit_scope_violation` log event; the commit proceeds with the in-scope remainder. A commit left empty settles as no-progress, not success.
- Regression check: a staged path whose new blob equals that path's blob at an older `main` commit while current `main` differs is refused the same way (stale-main sweep), even when in scope.
- Ready-gate repair: the attributable allowset is intersected with the frozen diff/spec allowset; a gate failure attributable only to out-of-scope paths is a pre-existing failure and settles without agent repair.
- The scope source is the run's own diff from durable state, not the worktree's current changes.

## Acceptance criteria

- [ ] Committer test: a worktree with an in-scope edit plus an untouched-by-run file → only the in-scope path is committed, the other is reverted and named; fails against the pre-fix `add -A`.
- [ ] Test: a staged file whose content matches an older `main` blob (current `main` differs) is refused even when in the run diff.
- [ ] Test: shrink, resume-recovery, and write completion each route through the scope check (one test per path, fake git).
- [ ] Test: ready-gate repair with a lint failure attributable only to a path outside the run diff → no agent repair edit to that path; settles as pre-existing failure; fails against the pre-fix `resolveAttributableRepairAllowset`.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — commit scope check and stale-main regression refusal on every harness commit path.
- `v2/docs/workflow-runner.md` — ready-gate repair allowset is intersected with the run diff.
- `v2/docs/operator-practices.md` — diff each lane against its merge base before merge remains required until this lands.
