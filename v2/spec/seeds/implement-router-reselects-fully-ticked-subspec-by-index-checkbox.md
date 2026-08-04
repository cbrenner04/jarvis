---
name: implement-router-reselects-fully-ticked-subspec-by-index-checkbox
---

# Implement router re-selects a fully-ticked subspec by its unchecked index checkbox and settles no-work/completed

## Problem

The implement write step routes to the next subspec by the first **unchecked `index.md` checkbox**,
not the first subspec with unticked acceptance criteria. When a subspec's acceptance criteria are all
ticked but its `index.md` checkbox is still `- [ ]` (e.g. it was hand-finished and merged rather than
completed through the workflow, so Jarvis never ticked the index), the router re-selects that
already-complete subspec, finds nothing to do, and settles `no-work`/`completed` — never advancing to
the genuinely-incomplete next subspec.

This contradicts the runbook's own rule that "linked-index checkboxes are not the completion source of
truth" — which the ALREADY_COMPLETE preflight honors, but the per-subspec router does not.

## Evidence

2026-08-04, `20260803T214753Z-fan-out-concurrent-sibling-dispatch`. Subspec 00 was hand-finished and
merged (#2584) without ticking its index checkbox; main's `index.md` read `- [ ] 00`, `- [ ] 01` with
00's acceptance criteria all ticked. Implement re-run `328c3cc6` (fresh worktree from main) selected
subspec 00, resolved `no_file_changes` → `no-work` → `completed`, ticked the index-00 box locally
(uncommitted), and never touched subspec 01. Recovery: hand-tick the index (#2585), then re-run —
which then correctly routed to 01. Distinct from
`implement-rerun-completes-over-a-stale-dirty-worktree` (that is a stale/dirty worktree inheriting
ticks; this is a fresh worktree with an honest but index-mismatched main).

## Decisions

- The router selects the first subspec with unticked non-human-only acceptance criteria, independent
  of its `index.md` checkbox state — rules out re-selecting a fully-ticked subspec whose index box
  lags.
- A run that finds every subspec's criteria ticked settles `already_complete` (the existing tree-level
  contract), never `no-work`/`completed` on a single fully-ticked subspec — rules out a false
  `completed` that implies a commit/PR/gate that never happened.
- Out of scope: whether hand-finishing should tick the index (operator procedure; see runbook note
  below); the `no-work`-over-dirty case (separate seed).

## Acceptance criteria

- [ ] A regression drives the router against a spec tree whose earlier subspec has all criteria
      ticked but an unchecked `index.md` box and a later subspec with unticked criteria; it asserts
      the router selects the later subspec, and fails against index-checkbox routing.
- [ ] A regression asserts a run over a tree where one subspec is fully ticked (index box unchecked)
      and another is incomplete does not settle `no-work`/`completed` on the ticked one.
- [ ] Mutation checkpoint: a `// @mutate` directive reverting the router to index-checkbox selection
      turns its pinning test RED.
- [ ] `bun run typecheck`, `bun run check`, `bun run lint:md`, `bun run test:v2`, and
      `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — until this ships, note that hand-finishing a subspec must also tick
  its `index.md` checkbox, or the next implement run no-ops on the completed subspec.
- `v2/docs/v1-behaviors.md` — record the router now keys off criteria, not index checkboxes.

## Prerequisites

- The implement write-step subspec router (`index.md` checkbox scan) and its relationship to the
  tree-level ALREADY_COMPLETE preflight.
