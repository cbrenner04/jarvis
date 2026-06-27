---
name: v1-behaviors-append-conflict-hotspot
---

# v2/docs/v1-behaviors.md is a recurring merge-conflict hotspot

## Problem

Nearly every spec carries a "record the behavior in `v2/docs/v1-behaviors.md`"
documentation task (per the `specs-update-v1-behaviors` convention), so concurrent
specs all append to the **same file**. On integration-merge (merging `main` into a
branch that branched before sibling merges), this conflicts repeatedly. Resolved
by hand twice in the 2026-06-27 session alone; pure operator toil with no judgment
content (always "keep both appends").

## Direction

Make v1-behaviors updates merge-clean. Weigh:

- Per-spec fragment files (e.g. `v2/docs/v1-behaviors.d/<spec>.md`) aggregated by a
  generated index, so each spec writes its own file (no shared-line conflicts), or
- A strictly append-only section with a convention/tooling that makes union-merge
  safe (`.gitattributes merge=union` on the file), or
- A generated `v1-behaviors.md` assembled from per-spec entries.

Goal: two specs documenting behavior in the same session never conflict on this
file. Keep it human-readable.

## Documentation updates

- `v2/docs/` — document the new structure / generation step.
- Operator runbook integration-merge section — drop v1-behaviors from the
  hand-resolve list once conflicts stop.
