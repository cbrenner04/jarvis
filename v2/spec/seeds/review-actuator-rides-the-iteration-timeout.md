# The review actuator rides the iteration timeout to a failed run

## Problem

The review `actuator` role can consume the entire `iterationTimeoutMs` budget and settle the whole
workflow `failed` / `invocation_error`, discarding a completed implementation.

Observed 2026-07-22 on `20260722T015205Z-runtime-smoke-exercises-cli-daemon-handshake`, agent order
`claude → codex → cursor`. Every other role finished normally; the actuator hit the wall twice:

```text
{"agent":"claude","model":"claude-haiku-4-5","exit_kind":"ok",   "role":"implement"}
{"agent":"claude","model":"claude-sonnet-5",  "exit_kind":"ok",   "role":"shrink"}
{"agent":"claude","model":"claude-opus-4-8",  "exit_kind":"ok",   "role":"adversary"}
{"agent":"claude","model":"claude-opus-4-8",  "exit_kind":"ok",   "role":"advocate"}
{"agent":"claude","model":"claude-opus-4-8",  "exit_kind":"ok",   "role":"adjudicator"}
{"agent":"claude","model":"claude-sonnet-5",  "exit_kind":"error","role":"actuator","duration_ms":598116}
{"agent":"claude","model":"claude-sonnet-5",  "exit_kind":"error","role":"actuator","duration_ms":600184}
```

`598116` and `600184` ms are the 600s `iterationTimeoutMs`, not a crash. Deterministic across two
runs. The implementation itself had already committed (`8e405d86`); the run still ended
`invocation_error`, `retryable: false`, `nextAction: stop`, and published no PR.

Three problems stack here:

- **A slow actuator destroys finished work.** The adjudicated verdict and the committed
  implementation are both discarded because the step that *applies* findings ran long.
- **The failure is unattributed.** `invocation_error` on the run row names no role, no model, and no
  timeout. The only way to learn it was the actuator was reading `~/.jarvis/telemetry.jsonl` and
  noticing `duration_ms` ≈ the timeout.
- **Wall-clock is the only bound.** v2 has no idle-output watchdog (`v2/docs/operator-runbook.md`
  § Choosing an actuator), so a productive-but-slow actuator and a hung one are indistinguishable;
  both ride to 600s.

Operator workaround today: re-run with `--review-passes 0`, which lands the work but drops review
entirely. That is what was done to land this spec.

## Decisions

- Attribute a role-invocation timeout in the run row: name the role, agent, model, and the bound
  hit; rules out a bare `invocation_error` that requires telemetry archaeology.
- Do not discard a committed implementation because a review-application step timed out. Preserve
  the commit and the adjudicated verdict, and settle so the operator can resume or land without
  re-running the write step; rules out the current all-or-nothing failure.
- Give the actuator its own bound, separate from the write-step `iterationTimeoutMs`; rules out one
  global timeout serving both a full implementation and a findings-application pass.
- Do not fix this by raising `iterationTimeoutMs` globally; rules out masking a slow actuator by
  giving every role longer.

## Acceptance criteria

- [ ] An actuator invocation that exceeds its bound settles with an error naming the role, agent,
      model, and the timeout value.
- [ ] Regression coverage drives an actuator timeout and asserts the run retains the implementation
      commit and the adjudicated verdict; it fails against the current discard behavior.
- [ ] The resulting run state is actionable — the operator can land or resume without re-running the
      write step.
- [ ] A normal-duration actuator run is unaffected, and the write step keeps its existing bound.
- [ ] Tests pin every added or modified guard in both directions so inverting any guard fails; where
      a guard suppresses an effect, the negative case proves the effect is absent.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — per-role invocation bounds and actuator timeout semantics.
- `v2/docs/operator-runbook.md` § Gate trust — how a timed-out review step is reported and recovered.
