---
name: runbook-scoped-abandon-recovery
---

# Runbook recovery uses scoped abandon

## Problem

Operator recovery guidance still points at global `jarvis1 cleanup --abandon` or manual git teardown for stale interrupted plan worktrees. Once scoped abandon ships, the runbook should document the safe path and drop stopgap manual worktree removal.

## Desired behavior

Update `v1/docs/operator-runbook.md` recovery sections — at minimum transient-killed plan worktrees and CI-only re-implement abandon — to use `jarvis1 cleanup --abandon <worktree-name>` with the concrete worktree name. Remove manual `git worktree remove` stopgap guidance tied to this recovery. Leave global end-of-session `jarvis1 cleanup` guidance intact.

## Decisions

- `v1/docs/operator-runbook.md` is the operator durable home for recovery workflow — rules out documenting the procedure only in `v2/docs/v1-behaviors.md`.
- Edit only recovery flows this seed targets — rules out rewriting unrelated cleanup or triage sections.

## Documentation updates

- `v1/docs/operator-runbook.md` — scoped abandon in transient-killed plan and targeted abandon recovery; remove manual worktree-remove stopgap.

## Prerequisites

- `jarvis1 cleanup --abandon <worktree-name>` retires one named eligible worktree without scanning unrelated worktrees
