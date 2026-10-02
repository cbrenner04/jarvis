---
name: force-kill-retiring-owner-row
---

# Force kill clears a retiring owner’s stranded row

## Problem

A live retiring daemon identity blocks force-killing a non-terminal row even when that daemon has no active execution for it.

## Decisions

- Use direct-owner execution evidence before overriding live ownership; force kill may settle a proven inactive row, while active or unobservable live owners retain existing routing and safety.

## Prerequisites

none

## Documentation updates

- v2/docs/operator-runbook.md, v2/docs/daemon-host.md and v2/docs/v1-behaviors.md describe force-kill owner evidence.
