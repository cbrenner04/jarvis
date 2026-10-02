---
name: linked-resume-admitted-row
---

# Linked resume executes its admitted row

## Problem

Resuming a linked implement row currently re-enters the snapshot’s base step and strands the admitted ~link-N row.

## Decisions

- Execute the admitted linked row or settle it terminal with a pointer to its replacement; track it through resume, failure and kill while preserving linked/shrink/review/publication sequencing.

## Prerequisites

none

## Documentation updates

- v2/docs/operator-runbook.md and v2/docs/v1-behaviors.md describe linked-row resume settlement.
