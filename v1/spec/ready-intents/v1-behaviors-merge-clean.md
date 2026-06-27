---
name: v1-behaviors-merge-clean
---

# Concurrent specs never conflict on v1-behaviors.md

## Problem

Nearly every spec carries a "record the behavior in `v2/docs/v1-behaviors.md`"
doc task, so concurrent specs all append to the same file. Integration-merge
conflicts repeatedly — pure operator toil, always resolved "keep both appends".

## Direction

Make v1-behaviors updates merge-clean so two specs documenting behavior in the
same session never conflict on this file. Keep it human-readable. Pick one
mechanism in plan mode (weigh per-spec fragment files aggregated by a generated
index, a `.gitattributes merge=union` append-only convention, or a generated
`v1-behaviors.md` assembled from per-spec entries).

## Documentation updates

- `v2/docs/` — document the new structure / generation step.
- Operator runbook integration-merge section — drop v1-behaviors from the
  hand-resolve list once conflicts stop.

## Prerequisites

- Specs append behavior entries to a shared v2/docs/v1-behaviors.md catalog
