---
name: exhausted-rungs-fail-without-retry-later
---

# Timeout with every rung exhausted names the rungs and does not say retry_later

`role_timeout` maps to `nextAction: "retry_later"`, so the documented recovery is a re-dispatch that
reproduces a deterministic overrun at full cost (~30 minutes per attempt). When no rung is left, say
so.

## Decisions

- A role that times out on its last configured rung settles with an error naming the exhausted rungs (agent + model per rung); rules out a bare `role_timeout` that hides which models were tried.
- That settlement does not report `nextAction: "retry_later"`; rules out advertising a retry that is known to reproduce.
- Timeout retains its retryable mapping only while a further rung exists; rules out flipping all timeouts to non-retryable and breaking the escalation path.

## Acceptance criteria

- [ ] A role that exhausts every rung settles with an error naming the exhausted rungs and does not report `nextAction: "retry_later"`; inverting the guard fails the test.

## Documentation updates

- `v2/docs/operator-runbook.md` — correct the `role_timeout` recovery: re-dispatch does not fix a deterministic overrun; document rung escalation and what to do when rungs are exhausted.

## Prerequisites

- A role invocation that exceeds its wall clock retries on the next configured rung (introduced by `role-timeout-escalates-to-next-rung`, same seam — plan/run that intent first and merge it before this one; do not fan these two out in parallel off the same base).
