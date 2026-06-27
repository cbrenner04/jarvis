---
name: commit-false-source-spec-rerun-reset
---

# Re-running a commit:false spec restores the external source spec to its pre-run state

## Problem

A `commit:false` run mutates the external source spec in `~/.jarvis/specs/<proj>/`
in place: it ticks acceptance-criteria checkboxes and may append a `## Blocker`.
The existing no-commit auto-reset does not cover this external spec, so re-running
an incomplete item is not idempotent — the operator must hand-revert ticks and
strip the appended blocker first (carefully, since a blocker placed before the AC
can clobber the AC if stripped naively).

## Direction

On re-run, restore the external `commit:false` source spec to its pre-run state
before the next agent invocation, mirroring the in-repo no-commit auto-reset:
un-tick only the AC ticked by the prior incomplete run, drop the blocker the prior
run appended, and preserve pre-attempt checkboxes. Track per-run delta against the
external spec path so resets are scoped to that run's mutations.

## Documentation updates

- Operator runbook "No-commit re-run auto-reset" — state external `commit:false`
  source specs are covered.
- `v1/docs/config.md` `commit:false` notes — re-runs are self-cleaning.

## Prerequisites

- The no-commit auto-reset tracks per-run newly-ticked AC and appended blockers and reverts them before the next invocation.
