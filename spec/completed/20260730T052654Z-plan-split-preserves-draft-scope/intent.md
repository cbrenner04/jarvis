---
name: plan-split-preserves-draft-scope
---

# Plan split preserves every drafted decision and criterion

## Problem

Splitting a drafted subspec can drop or duplicate decisions and acceptance criteria if the plan step
re-derives scope instead of distributing the draft verbatim.

## Decisions

- Every `## Decisions` bullet and every `## Acceptance criteria` checkbox from the oversized draft
  appears in exactly one emitted subspec, assigned to the subspec that owns its module boundary.
  Rules out re-deriving criteria or omitting draft text.
- Every `## Documentation updates` bullet from the oversized draft appears in exactly one emitted
  subspec. Rules out dropping or duplicating doc bullets across children.
- Problem, evidence, and task-checklist sections are not verbatim-copied into every emitted subspec;
  boundary-local authoring there is allowed. Rules out treating those sections under the exactly-one
  verbatim rule for decisions and acceptance criteria.

## Acceptance criteria

- [ ] Every decision and acceptance criterion from the drafted subspec appears in exactly one emitted
      subspec; none is dropped or duplicated; a fixture drives the plan step and fails when content
      is lost or repeated.
- [ ] Inverting the preservation check turns that fixture test RED.

## Documentation updates

- Deferred to first consumer: durable doc bullet for verbatim preservation scope — pin when the
  preservation fixture names the operator-facing wording.

## Prerequisites

- The plan step replaces a multi-boundary drafted subspec with multiple emitted subspecs, each owning one module boundary
