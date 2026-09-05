---
name: pipeline-restart-discards-disposable-stage-state
---

# Pipeline restart treats pre-landing stage state as disposable

## Problem

Restarting a pipeline lane refuses on the state of artifacts the restart exists to replace. 2026-09-05: three chess pipeline lanes all failed *before dispatch* — worktrees not up to date with the base and/or a leftover `## Blocker` inside a never-landed plan-stage draft tree. The operator's read is right: this state is throwaway (nothing landed, no PR), yet the gates force manual worktree surgery per lane. The `--reset-despite-*` flags (spec `20260902T051154Z`) don't cover it: the operator-`## Blocker` and staleness refusals are gates those flags deliberately preserve, and flag-per-gate is the wrong shape anyway — a restart of a dead lane should not need the operator to enumerate which refusals to override.

## Decisions

- On restart/resume of a lane whose prior attempt landed nothing (no PR, no commits merged, no unpushed committed work beyond the harness's own staging), the stage worktree and staged drafts are disposable: rematerialize from the current base and discard inherited `## Blocker` files and stale trees without flags; rules out pre-dispatch refusals over state the restart replaces.
- The safety edge is real work, not age: unpushed commits with no PR refuse disposal and name the salvage path (the [[abandon-refuses-unlanded-work-with-no-pr]] shape); rules out silently destroying an unlanded implementation.
- An operator `## Blocker` in a *landed* artifact (on `main` or a live PR) still blocks; one inside a discarded draft tree does not outlive the draft; rules out a dead attempt's blocker note permanently poisoning the lane.
- Fewer steps, not more flags: the default restart path performs the disposal; no new CLI surface; rules out growing the `--reset-despite-*` family per gate.

## Acceptance criteria

- [ ] A pipeline test proves restarting a lane with a stale worktree and an inherited draft-tree `## Blocker` (no PR, no unpushed real work) rematerializes and dispatches without flags; fails against the current pre-dispatch refusals.
- [ ] A test proves a lane worktree carrying unpushed commits with no PR still refuses and names the salvage path.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — restart disposal contract; retire the per-lane manual-teardown guidance.
- `v2/docs/pipeline-execution.md` — disposable-state boundary at restart.
