---
name: warn-on-shared-model-pool-contention
---

# Warn when patch primary shares a model pool with an active operator session

## Problem

The primary `claude` patch agent draws the same Claude pool as the operator's
orchestration loop. An active operator session starves it first, triggering an
immediate cascade onto cursor/opencode. The contention is invisible to the
operator at run start.

## Direction

Surface shared-pool contention: when the patch primary is configured to a model
pool also being consumed by an active operator/orchestration session, emit a
harness warning at run start so the operator can pause the competing session.
Warning only — does not block the run or change cascade behavior.

## Out of scope

- Changing agent selection or cascade order.
- Retry and residual-state normalization behaviors.

## Prerequisites

- Patch run selects a configured primary agent/model for actuation
