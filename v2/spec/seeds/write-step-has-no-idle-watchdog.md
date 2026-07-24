# The write step has no idle watchdog, only a flat wall clock

## Problem

The idle-output watchdog exists and works — it is just never armed on the write path.

`shared/invocation/agents.ts:251-257` implements it: given `idleOutputMs`, an invocation with no
stdout/stderr for that budget settles `result.kind === "stall"`. Exactly one call site passes it,
`v2/src/execution/review-role-invocation.ts:64` (#1998, review roles only). The write path's three
`executeWithQuotaFallback` call sites — `v2/src/execution/step-runner.ts:108`, `:125`, `:245` — all
omit it, so the write step, plan draft, and intent split run unwatched.

Their only bound is a flat wall clock: `awaitIteration` arms one `setTimeout` at
`v2/src/execution/write-loop.ts:615-618` for `iterationTimeoutMs ?? DEFAULT_ITERATION_TIMEOUT_MS`
(600_000; the operator's `~/.jarvis/config.json` sets 1_800_000). It cannot tell a silent agent from a
working one, so it is wrong in both directions:

- **A stalled agent burns the whole budget.** 30 minutes of silence is indistinguishable from
  30 minutes of work, and the run then fails `iteration_timeout` — `retryable: false`,
  `nextAction: "stop"` (`finishIterationTimeout`, `write-loop.ts:635`).
- **A slow-but-progressing agent is killed at the ceiling.** Raising the flat bound to accommodate
  the slowest agent is what makes the first failure mode cost 30 minutes.

Observed 2026-07-23 — three `iteration_timeout` rows in three days, two of them on the single spec
that stranded across eight attempts:

```text
3f9e19e6  20260723T140222Z-run-list-query-limit-cap        failed  iteration_timeout  false  stop
ea44e0db  20260723T140222Z-run-list-query-limit-cap        failed  iteration_timeout  false  stop
197ea646  20260723T132244Z-resume-accepts-landing-failed   failed  iteration_timeout  false  stop
```

`run-list-query-limit-cap` timed out at iteration 1 on **cursor and claude back-to-back**, which is
what a missing idle signal looks like: neither agent is at fault and the harness cannot tell which
one stopped producing. The prior session's diagnosis attributed it to "a degraded inference window" —
unfalsifiable precisely because there is no output-age measurement to check.

This is the same class of blindness the v1 runbook records for claude before
`claude-streams-output-to-watchdog`: 33 of 33 patch records carried `last_output_age_ms: null` and
the resulting folklore ("claude is too slow") survived two sessions. Zero output was a missing
measurement, not a slow agent. v2's write step is in that state today.

## Decisions

- Arm the existing `idleOutputMs` budget on the write path's invocations. Reuses the shared watchdog
  and the operator's existing `idleOutputTimeoutMs` config key; rules out a second stall mechanism.
- A write-loop iteration whose agent produces no output for the idle budget settles its **own**
  outcome kind, distinct from `iteration_timeout`, with its own operator-visible reason. Rules out
  reporting a fast idle failure as the wall-clock timeout, which is what makes today's rows
  undiagnosable.
- The iteration wall clock becomes **progress-extended**: output resets the remaining budget, bounded
  by a hard ceiling so a chatty-but-looping agent still terminates. Rules out both a flat bound (kills
  slow-but-working agents) and an unbounded one.
- The idle budget must be below the wall clock, and the wall clock below the ceiling; a config that
  inverts them is rejected at load rather than silently disarming the watchdog. Same property
  `idle-output-timeout-default-below-iteration-wall` established for review roles.
- Attribute the stall the way review roles do — agent, model, and the bound that fired — so the next
  "which agent went quiet" question is answerable from the row instead of from folklore.
- Out of scope: **what survives** a stalled iteration. Preserving partial work is
  `commit-each-write-iteration`; making the outcome resumable is the write-path sibling of
  `role-stalled-discards-a-committed-write-step`. This seed decides *when* the harness gives up, not
  what it keeps.
- Out of scope: why an agent goes quiet.

## Acceptance criteria

- [ ] A write-loop test drives an agent that produces no output past the idle budget and asserts the
      iteration settles the new idle outcome kind — not `iteration_timeout` — well before the
      iteration wall clock elapses; it fails against the pre-fix code.
- [ ] An agent that keeps producing output past the original wall clock is **not** terminated, and
      completes; inverting the extension (ignoring output) fails this test.
- [ ] An agent that produces output continuously is still terminated at the hard ceiling.
- [ ] `run list` / `run wait` report the idle failure with its own `error.reason`, distinct from
      `iteration_timeout`, carrying agent, model, and the bound that fired.
- [ ] A config whose idle budget exceeds the iteration wall clock, or whose wall clock exceeds the
      ceiling, is rejected at load with a message naming both bounds.
- [ ] The plan-draft and intent-split write paths are armed too — a test asserts a silent agent on
      each settles the idle outcome, so the fix is not scoped to the implement write step alone.
- [ ] An iteration that completes normally records no stall and no timeout; the negative case proves
      the watchdog does not fire on healthy runs.
- [ ] `bun run typecheck`, `bun run test:v2`, `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — the write loop's three bounds (idle budget, progress-extended
  iteration wall clock, hard ceiling) and which one fires when.
- `v2/docs/daemon-host.md` — the new idle outcome row: reason, retryability, `nextAction`.
- `v2/docs/install-and-config.md` — the config keys and the ordering constraint between them.
- `v2/docs/operator-runbook.md` — replace § Choosing an actuator's claim that "v2 still has no
  idle-output watchdog — only a wall-clock `iterationTimeoutMs`", and its conclusion that "operator
  discipline and CI guardrails replace it."
- `v2/docs/v1-behaviors.md` — v2 write-loop parity with v1's idle-output watchdog.

## Prerequisites

- The shared idle-output watchdog settles `result.kind === "stall"` on an idle invocation
  (`shared-invocation-idle-output-watchdog`).
- Review roles already arm it and attribute the stall (#1998).

## Unblocks

- `wedged-workflow-kill-needs-a-live-stall-signal` names this exact signal as its blocker: its
  `reapable` discriminant needs a stall observable *while the run is still live*, and all four prior
  attempts failed because every signal they latched on coincided with termination. A progress-extended
  wall clock plus an idle budget produces that live signal.
