---
name: write-step-cascades-on-quota
---

# Write step cascades on quota instead of blocking

## Problem

Quota exhaustion is handled inconsistently inside one workflow. Review roles advance down `agents`;
the write/implement step instead ends the run `blocked` with `reason: agent_blocked` /
`nextAction: inspect_spec` / `resumable: false`, sending the operator to inspect a spec that is fine.

Observed 2026-07-22 on `20260722T015205Z-runtime-smoke-exercises-cli-daemon-handshake`, agent order
`codex → claude → cursor`, run `2e591285-974b-4ff7-ad69-12c9daa524d6`. Telemetry in the same window
shows `adjudicator` hitting `exit_kind: quota` on codex and re-running on claude; the write step hit
the same wall and settled blocked with the agent-authored text "Execution commands are unavailable:
the environment rejected validation with its usage limit before the required v2 gates could run."

`claude` was available and idle. Quota is an environment condition, not an agent blocker, and the
harness already carries the real signal (`exit_kind`) from the same invocation layer that
`executeWithQuotaFallback` uses for review roles.

## Decisions

- Classify quota from the invocation result (`exit_kind`), not agent-authored blocker prose; rules out string-matching "usage limit" out of a `## Blocker`.
- Advance the write/implement step down `agents` on quota, matching review-role behavior; rules out a write-step-specific quota policy.
- Settle all-rungs-quota with a terminal reason naming quota and the rungs tried, not `agent_blocked` / `inspect_spec`; rules out reusing the blocker path for an environment condition.
- Leave genuine `## Blocker` handling unchanged; rules out swallowing real agent blockers into the quota path.

## Acceptance criteria

- [ ] A write/implement invocation returning a quota exit advances to the next configured agent and continues the run.
- [ ] Regression coverage drives a quota exit on the first rung and asserts the second rung runs; it fails against the current blocked-on-quota behavior.
- [ ] Quota exhaustion on every rung settles with a reason naming quota and listing the rungs attempted, and reports neither `agent_blocked` nor `nextAction: "inspect_spec"`.
- [ ] An agent that appends a genuine `## Blocker` unrelated to quota still reports `agent_blocked` with `nextAction: "inspect_spec"`, unchanged.
- [ ] A blocker whose prose merely mentions a usage limit is not reclassified as quota.
- [ ] Tests pin every added or modified guard in both directions so inverting any guard fails; where a guard suppresses an effect, the negative case proves the effect is absent.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — quota advances the rung for every role, including the write step.
- `v2/docs/write-behavior.md` — quota exit is not a blocker outcome.
- `v2/docs/operator-runbook.md` — a quota-exhausted run names quota; it is not a spec blocker.
- `v2/docs/v1-behaviors.md` — record the changed write-step quota behavior in the parity baseline.

## Prerequisites

- Write/implement steps resolve bindings across the configured `agents` order, not a single agent.
- The invocation layer classifies a quota exit distinctly from `ok` and from other failures.
- Operator-facing terminal reasons include a quota-exhausted reason distinct from `agent_blocked`.
