# The write step blocks on quota while review roles cascade

## Problem

Agent quota exhaustion is handled inconsistently within a single workflow. Review roles advance down
`agents` as designed; the write/implement step instead ends the run `blocked` with an agent-authored
blocker, sending the operator to inspect a spec that has nothing wrong with it.

Observed 2026-07-22 on `20260722T015205Z-runtime-smoke-exercises-cli-daemon-handshake`, agent order
`codex → claude → cursor`. Telemetry for the same window shows the cascade working for review:

```text
{"agent":"claude","model":"claude-opus-4-8","exit_kind":"ok","role":"advocate"}
{"agent":"codex","model":"gpt-5.6-sol","exit_kind":"quota","role":"adjudicator"}
{"agent":"claude","model":"claude-opus-4-8","exit_kind":"ok","role":"adjudicator"}
{"agent":"codex","model":"gpt-5.6-terra","exit_kind":"quota","role":"actuator"}
```

`adjudicator` hit quota on codex and re-ran on claude. The write step, hitting the same wall, produced
this instead (run `2e591285-974b-4ff7-ad69-12c9daa524d6`):

```json
{"runStatus":"blocked","loopOutcomeKind":"blocked","iterationsConsumed":1,"resumable":false,
 "error":{"reason":"agent_blocked","retryable":false,"nextAction":"inspect_spec"}}
```

with the blocker text:

> Execution commands are unavailable: the environment rejected validation with its usage limit
> before the required v2 gates could run.

Three things are wrong with that outcome:

- **No cascade.** `claude` was available and idle — the same rung that had just served `adjudicator`
  seconds earlier. The run should have advanced to it.
- **Wrong classification.** Quota is an *environment* condition, not an agent blocker.
  `reason: agent_blocked` / `nextAction: inspect_spec` points the operator at spec prose that is
  fine, and `resumable: false` makes it terminal.
- **Detection is prompt-shaped, not signal-shaped.** The write step only learned about quota because
  the agent wrote prose about it. The harness already has the real signal — `exit_kind: quota` in
  telemetry, from the same invocation layer.

The operator recovery today is to notice the wording, change `agents` by hand, and re-run.

## Decisions

- Classify quota from the invocation result (`exit_kind`), not from agent-authored blocker prose;
  rules out string-matching "usage limit" out of a `## Blocker`.
- Advance the write/implement step down `agents` on quota, matching review-role behavior; rules out
  a write-step-specific quota policy.
- When every rung is quota-exhausted, settle with a distinct terminal reason naming quota and the
  rungs tried — not `agent_blocked` and not `inspect_spec`; rules out reusing the blocker path for
  an environment condition.
- Leave genuine `## Blocker` handling unchanged; rules out swallowing real agent blockers into the
  quota path.

## Acceptance criteria

- [ ] A write/implement invocation returning a quota exit advances to the next configured agent and
      continues the run.
- [ ] Regression coverage drives a quota exit on the first rung and asserts the second rung runs;
      it fails against the current blocked-on-quota behavior.
- [ ] Quota exhaustion on **every** rung settles with a reason naming quota and listing the rungs
      attempted, and does not report `agent_blocked` or `nextAction: "inspect_spec"`.
- [ ] An agent that appends a genuine `## Blocker` unrelated to quota still reports `agent_blocked`
      with `nextAction: "inspect_spec"`, unchanged.
- [ ] Quota classification reads the invocation result, and a blocker whose prose merely mentions a
      usage limit is not reclassified as quota.
- [ ] Tests pin every added or modified guard in both directions so inverting any guard fails; where
      a guard suppresses an effect, the negative case proves the effect is absent.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — quota advances the rung for every role, including the write step.
- `v2/docs/operator-runbook.md` — a quota-exhausted run names quota; it is not a spec blocker.
