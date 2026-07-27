---
name: plan-split-preserves-draft-scope
---

# Plan split preserves every drafted decision and criterion

## Problem

Splitting a drafted subspec can drop or duplicate decisions and acceptance criteria if the plan step
re-derives scope instead of distributing the draft verbatim.

## Decisions

- Every decision and acceptance criterion from the oversized draft appears in exactly one emitted
  subspec, assigned to the subspec that owns its module boundary. Rules out re-deriving criteria or
  omitting draft text.

## Acceptance criteria

- [ ] Every decision and acceptance criterion from the drafted subspec appears in exactly one emitted
      subspec; none is dropped or duplicated; a fixture drives the plan step and fails when content
      is lost or repeated.

## Prerequisites

- The plan step replaces a multi-boundary drafted subspec with multiple emitted subspecs, each owning one module boundary
