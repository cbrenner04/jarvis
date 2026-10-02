---
name: linked-resume-settles-the-admitted-link-row
---

# Linked-row resume strands the admitted row and respawns implement on every handoff

**Priority: highest.** Wastes agent runs on already-landed lanes, emits a false "workflow finished", and blocks cleanup.

## Problem

`jarvis run resume` (or `pipeline resume` / startup recovery) on an `implement~link-N` row goes through `resumeLinkedWorkflowRow` (`v2/src/daemon/daemon-run-lifecycle-handlers.ts:1453-1488`): `admitRunForResumeOrRefusal` flips the row to `in-progress`, then `resumeLinkedWorkflowStart` (`daemon-workflow-admission-handlers.ts:513-545`) runs a fresh workflow under a new `claimRunId` whose steps (`reconstructLinkedWorkflowResumeSteps`, `workflow-runner-resume.ts:1895-1897`) use the snapshot stepId `implement`, not `implement~link-N`. A new `implement` row runs; the admitted link row is never executed or settled.

Consequences:

- The stranded row stays `in-progress`. On every daemon start `beginRunReconciliation` (`state-store.ts:3655-3680`) reconciles it and `recoverReconciledRuns` (`daemon.ts:1388-1401`) resumes it again, spawning another `implement` run on the same branch each handoff, even after the lane landed.
- The invocation's settled marker and `run-ad-hoc-terminal: completed` fire while the link row is still non-terminal.
- `run kill --force` refuses (`run_not_active`): the row's owner is a live retiring daemon generation, which `forceKillOwnerAdmits` (`state-store.ts:3647-3652`) refuses.
- `jarvis cleanup` treats the non-terminal row as ownership (`cleanup.ts:293-300`, `1010-1017`) and never retires the worktree.

## Evidence

2026-10-01/02: link rows `1b884b4b`, `f48b0556`, `7194c5ef`, `a84c40f7` (lanes later landed as #4404, #4403, #4376, #4402) showed `in-progress` / `not-live` for 13–14 h, each recording `run_recovery: resumed` four times (19:26, 21:31, 22:43, 01:07). Each recovery created a fresh implement run on its landed branch (e.g. `8402241a`, `01d54dd4`, `13c2fc28`, `6d78eaf8`). The operator could only dismiss them.

## Decisions

- Linked resume executes and settles the admitted `~link-N` row itself: the resumed workflow re-enters at that row's stepId and run id, or (if the design must stay a fresh invocation) the admitted row is settled terminal with a pointer to the run that replaced it. A resume never leaves the admitted row non-terminal.
- An invocation's settled marker and `run-ad-hoc-terminal` incident are written only when every row in the invocation is terminal.
- Startup recovery does not auto-resume a link row whose lane already published (open/merged PR evidence on the invocation or a later invocation on the branch); it settles it instead.
- `run kill --force` settles a non-terminal row whose recorded owner is live but has no active execution for it (retiring generation), instead of returning `run_not_active`.

## Acceptance criteria

- [ ] `daemon-run-lifecycle-handlers.test.ts` (or the resume-specific sibling): resuming a `~link-N` row leaves no row of that invocation non-terminal after the resumed workflow settles; fails against current code (admitted row stays `in-progress`).
- [ ] Same surface: the settled marker / `run-ad-hoc-terminal` incident is not emitted while any row of the invocation is non-terminal; fails against current code.
- [ ] `daemon.test.ts` (recovery): a reconciled link row whose lane has published PR evidence is settled, not resumed, and no new implement row is created; fails against current code.
- [ ] Kill test: `run kill --force` on a non-terminal row owned by a live retiring generation with no active execution settles it `killed`; fails against current `run_not_active`.
- [ ] `bun run typecheck`, `bun run test:v2`, `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — Paused linked implement rows / Clearing a stale non-active run: resume settles the link row; `--force` reaches retiring-owner rows.
- `v2/docs/daemon-host.md` — recovery skips published lanes; settled-marker requires all rows terminal.
- `v2/docs/v1-behaviors.md` — record.
