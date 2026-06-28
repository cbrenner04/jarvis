# Seed: cleanup must not archive a spec while its implementation is in flight

## Problem

`jarvis1 cleanup` archived an active spec into `completed/` after only the
spec's **plan** PR merged, while its **implementation** run was still in
flight. Observed 2026-06-28 with `daemon-run-control-handler-factory`: the plan
PR (#751) merged, a `jarvis1 run` was implementing the spec on its branch, and a
concurrent `cleanup` moved the spec dir to `v2/spec/completed/`. When the impl
PR (#752) tried to land it was `DIRTY` — main had relocated the spec, the impl
branch modified it at the original path (modify/delete conflict) — forcing a
hand integration-merge.

A spec's lifecycle spans **plan-merge → impl-merge**. Archiving on plan-merge
(or on any merged PR that merely touches the spec) is premature.

## Decisions

- Cleanup archives a spec only when its **implementation is complete and
  merged** — i.e. zero unchecked acceptance criteria across its subspecs and no
  open/in-flight impl PR or live patch worktree for that spec — rules out
  archiving on plan-PR merge alone.
- Detection keys on spec completion state + in-flight impl ownership, not on
  "some merged PR touched this spec dir" — rules out the false-positive that
  archived the in-flight spec here.
- An archive that would collide with a live patch worktree's branch is skipped
  with a logged reason — rules out silent premature moves.

## Documentation updates

- `v1/docs/operator-runbook.md` — note the impl-in-flight archive guard under
  end-of-session cleanup; once shipped, soften the `completed-archive-can-be-premature`
  caution to reference the guard.
- `v2/docs/v1-behaviors.md` — record the cleanup archival precondition if it
  changes observable behavior.

## Prerequisites

- `jarvis1 cleanup` archival logic exists and currently moves completed-looking
  spec dirs to `completed/`.
- Spec completion is derivable from acceptance-criteria checkbox state.
