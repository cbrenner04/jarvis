---
name: worktree-claimed-message-dedup
---

# Dedupe the worktree-already-claimed message

## Problem

The "Worktree already claimed for project=…, branch=…" message is built
independently 4 times in `v2/src/daemon/daemon.ts` (lines 58, 120, 658, 689).
Wording drift between the copies is possible with no guard against it.

## Direction

Build the message in one place, wording and fields unchanged; all 4 sites
call it.

## Prerequisites
