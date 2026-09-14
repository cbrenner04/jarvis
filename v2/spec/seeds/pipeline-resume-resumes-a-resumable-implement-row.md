---
name: pipeline-resume-resumes-a-resumable-implement-row
---

# `pipeline resume` re-dispatches an implement stage whose write row is resumable, and the re-dispatch refuses

## Problem

A chained implement stage whose write row settles resumable (`gate_invocation_refused`, `nextAction: resume`) is surfaced as a `stage-failed` incident. The documented stage recovery, `jarvis pipeline resume <id> <branch-key>`, reopens the stage and re-dispatches the implement workflow instead of resuming the retained write row. Re-dispatch runs the incomplete re-run preflight, which refuses because the lane's checkpoint commit is not on base (and `main` has usually moved), so the stage settles `failed` again and loses its `workflowInvocationId`. The only working recovery is `jarvis run resume <write-row-id>` — which the stage row does not name — after which the pipeline stage no longer tracks the running run.

## Evidence (2026-09-14)

Pipeline `d28c8d6e`, lane `tui-monitor-reexecs-on-daemon-revision-change`: write row `a2762fc9` (`implement~link-0`) settled `gate_invocation_refused` (slot held by a concurrent lane). `pipeline resume d28c8d6e <lane>` → stage `failed`: `Cannot re-run incomplete spec: branch has 1 commit(s) not on base (tip f071f6af…); … worktree HEAD … is not a descendant of base main (8a56aaea…); stale reuse refused`. `jarvis run resume a2762fc9…` then resumed it in place.

## Decisions

- When the failed implement stage's linked write row is resumable (`nextAction: resume`), `pipeline resume` resumes that row (same admission as `run resume`) and re-links the stage to it; re-dispatch stays the path only for non-resumable rows.
- The stage keeps tracking the resumed row, so its completion settles the stage and advances the pipeline.
- Out of scope: automatic re-drive of refused gate slots (`redrive-slot-refused-gates`).

## Acceptance criteria

- [ ] A test proves `pipeline resume` on an implement stage whose write row settled `gate_invocation_refused` resumes that row in place (no preflight re-run, no new worktree) even when base has advanced past the lane's merge base; it fails against the pre-fix re-dispatch.
- [ ] A test proves the resumed row's completion settles the stage `succeeded` and dispatches its successor.
- [ ] A test proves a non-resumable failed implement stage still re-dispatches as today.

## Documentation updates

- `v2/docs/operator-runbook.md` — pipeline resume on a resumable implement stage.
