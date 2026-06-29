---
name: triage-suggest-scoped-abandon
---

# Triage suggests scoped abandon for stale worktrees

## Problem

`jarvis1 triage <worktree-name>` on a dirty interrupted plan or patch worktree often ends at manual inspection or raw `git` discard steps. After scoped abandon exists, triage should name the safe jarvis recovery command.

## Desired behavior

Named triage drill-down suggests `jarvis1 cleanup --abandon <worktree-name>` when the worktree would pass scoped-abandon eligibility (not merged, no ready/non-draft PR, not multi-PR-ambiguous, no live lock) and manual salvage is the right next move — e.g. irreconcilable dirty/incomplete state where resume is not advised. Do not suggest scoped abandon when resume, finalize, or global cleanup is the better move.

## Decisions

- Suggest only the scoped cleanup form, not global `cleanup --abandon` — rules out reintroducing the unsafe multi-worktree preview.
- Gate suggestions on the same abandon eligibility checks scoped cleanup will enforce — rules out advertising abandon the command would refuse.
- Deferred to first consumer: exact suggested-moves rule ordering and which dirty/incomplete shapes flip from resume/discard git hints to scoped abandon — pin when triage rules are drafted.

## Documentation updates

- `v2/docs/v1-behaviors.md` — triage suggested-moves includes scoped abandon when eligible.

## Prerequisites

- `jarvis1 cleanup --abandon <worktree-name>` retires one named eligible worktree without scanning unrelated worktrees
