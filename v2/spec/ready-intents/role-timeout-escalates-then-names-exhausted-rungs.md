---
name: role-timeout-escalates-then-names-exhausted-rungs
---

# A role that exceeds its wall clock escalates, and names the rungs when none are left

Agent order advances on quota only, so a wall-clock overrun settles the run while a declared second
rung sits unreachable — the failure mode most likely to need it. This is why `claude.actuator`'s
declared sonnet fallback stayed unreachable while opus walled twice.

The failure report is wrong at the other end too: `role_timeout` maps to `nextAction: "retry_later"`,
so the documented recovery is a re-dispatch that reproduces a deterministic overrun at full cost
(~30 minutes per attempt).

## Decisions

- A role invocation that times out with a further configured rung available retries the role on that
  rung instead of settling; rules out today's quota-only advancement.
- Escalation is per role invocation, not per workflow: no earlier step is re-run to reach the retry.
- A role that completes inside its bound consumes no extra rung; rules out unconditional advancement.
- A role that times out on its **last** configured rung settles with an error naming the exhausted
  rungs (agent + model per rung); rules out a bare `role_timeout` that hides which models were tried.
- That settlement does not report `nextAction: "retry_later"`; rules out advertising a retry that is
  known to reproduce.
- Timeout retains its retryable mapping only while a further rung exists; rules out flipping all
  timeouts to non-retryable and breaking the escalation path.
- Out of scope: machine-profile rung ordering, and whether opus-5 is the right actuator model.

## Acceptance criteria

- [ ] A role invocation that exceeds its wall clock with a further rung configured retries on that
      rung; the test fails against pre-fix code, which settles `role_timeout`.
- [ ] A role that completes inside its bound consumes no extra rung.
- [ ] A role that exhausts every rung settles with an error naming the exhausted rungs and does not
      report `nextAction: "retry_later"`; inverting the guard fails the test.

## Documentation updates

- `v2/docs/agent-model-config.md` — wall-clock overrun advances the rung, alongside quota.
- `v2/docs/operator-runbook.md` — correct the `role_timeout` recovery: re-dispatch does not fix a
  deterministic overrun; document rung escalation and what to do when rungs are exhausted.

## Prerequisites

- Review roles are invoked over an ordered binding list that already advances on quota exhaustion.
- A review-role timeout is detected and attributed (`roleTimeout`) at the invocation layer.

Plan as two subspecs: escalation first, then the exhausted-rungs report — same seam, so they must
land in that order rather than fan out.
