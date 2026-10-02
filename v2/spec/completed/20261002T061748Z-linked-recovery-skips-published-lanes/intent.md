---
name: linked-recovery-skips-published-lanes
---

# Startup recovery settles published linked lanes

## Problem

Startup reconciliation resumes stranded linked rows even after their lane has published or merged.

## Decisions

- Before automatic linked-row resume, inspect durable publication evidence on its invocation or a later invocation on the same project and branch; settle published rows without launching implement. Preserve recovery of unfinished unpublished lanes.

## Prerequisites

none

## Documentation updates

- v2/docs/daemon-host.md, v2/docs/operator-runbook.md and v2/docs/v1-behaviors.md describe published-lane recovery.
