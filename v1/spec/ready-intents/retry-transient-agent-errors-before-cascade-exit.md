---
name: retry-transient-agent-errors-before-cascade-exit
---

# Retry transient agent errors before declaring agent-error

## Problem

A single transient agent failure (opencode `UnknownError`/500, network blip)
during a patch iteration ends the run with `agent-error (exit 3)`. A short
bounded retry/backoff would have ridden it out.

## Direction

Before classifying an iteration result as `agent-error`, retry transient
failures with bounded backoff. Transient = the existing transport/network
classification (opencode `UnknownError`/500, network blips), distinct from
quota (escalate to next agent) and no-progress (escalate). Reuse the existing
transient-retry machinery (`withSyncTransientRetry` / transient classification)
rather than inventing a new path. On retry exhaustion, fall through to the
existing `agent-error` exit unchanged.

## Out of scope

- Quota and no-progress cascade behavior (unchanged).
- Residual worktree/branch normalization on agent-error.

## Prerequisites

- Patch cascade exits agent-error (exit 3) when an iteration result classifies as a non-quota, non-progress agent error
- Transient network/transport error classification exists for agent results
- A bounded synchronous transient-retry-with-backoff helper exists
