---
name: ready-gate-retry-bound-test-coverage
---

# Test coverage for readyGateRetryBound completion-gate retries

## Problem

The per-project `readyGateRetryBound` knob re-runs the completion ready gate on
`retryable` red up to the bound (default 2 ⇒ 3 attempts), but shipped without
tests — its own plan verdict flagged the gap. The retry behavior is unguarded
against regression.

## Direction

Add tests over the completion-gate retry loop asserting:

- Retryable red re-runs the gate up to the bound, then passes if a later attempt
  is green.
- The gate runs exactly `bound + 1` attempts on sustained retryable red.
- Non-retryable red (commit/push failure) does not retry and returns red on the
  first attempt.
- Per-project `readyGateRetryBound` override is honored; default applies when
  unset.

## Out of scope

- Changing the default bound or the retryable-vs-non-retryable classification.
- Test-level flaky-vs-real quarantine inside a target project's suite.

## Prerequisites

- Per-project `readyGateRetryBound` re-runs the completion ready gate on retryable red up to the bound.
