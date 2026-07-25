---
name: role-timeout-escalates-to-next-rung
---

# A role that exceeds its wall clock retries on the next rung

Agent order advances on quota only, so a wall-clock overrun settles the run while a declared second
rung sits unreachable — the failure mode most likely to need it. Make timeout an advancement
trigger.

## Decisions

- A role invocation that times out with a further configured rung available retries the role on that rung instead of settling; rules out today's quota-only advancement.
- Escalation is per role invocation, not per workflow: no earlier step is re-run to reach the retry; rules out treating timeout like a run-level failure.
- A role that completes inside its bound consumes no extra rung; rules out unconditional rung advancement.
- Out of scope: the exhausted-rungs failure report, machine-profile rung ordering, and whether opus-5 is the right actuator model.

## Acceptance criteria

- [ ] A role invocation that exceeds its wall clock with a further rung configured retries on that rung; the test fails against the pre-fix code, which settles `role_timeout`.
- [ ] A role that completes inside its bound consumes no extra rung.

## Documentation updates

- `v2/docs/agent-model-config.md` — wall-clock overrun advances the rung, alongside quota.

## Prerequisites

- Review roles are invoked over an ordered binding list that already advances on quota exhaustion.
- A review-role timeout is detected and attributed (`roleTimeout`) at the invocation layer.

Note: `exhausted-rungs-fail-without-retry-later` depends on this intent's escalation behavior (same seam — role-timeout handling). Plan/run this intent first and merge before starting that one; do not fan the two out in parallel off the same base.
