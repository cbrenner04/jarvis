---
name: write-path-idle-output-watchdog
---

# Write-path invocations arm the idle-output watchdog and settle a distinct idle outcome

## Problem

Shared invocation already stalls silent children when callers pass `idleOutputMs`; review roles do.
Write-loop `executeWithQuotaFallback` call sites in `step-runner.ts` omit it, so implement, plan
draft, intent split, and reprompt invocations ride only the iteration wall. Silent agents then appear
as `iteration_timeout` after the full wall, which is undiagnosable in `run list`.

## Decisions

- Pass `idleOutputMs` from the operator's `idleOutputTimeoutMs` machine config (same key as v1) on every write-path `executeWithQuotaFallback` call site in `step-runner.ts` (primary step, token reprompt, blocker reprompt); omit `idleOutputMs` when `idleOutputTimeoutMs` is `0` (v1 disable semantics); rules out a second stall mechanism or an always-armed watchdog.
- Map invocation `result.kind === "stall"` to write-loop / attempt `outcomeKind` `idle_output_timeout` with matching `error.reason` on `run list` / `run wait` (parallel to `iteration_timeout`, not review `role_stalled`); rules out reporting a fast idle kill as wall-clock timeout or divergent strings across daemon-host and tests.
- Attribute idle failure with agent, model, and the idle bound that fired, matching review-role stall attribution; rules out folklore-only diagnosis.
- Terminal idle failure on the write path is non-retryable with `nextAction: "stop"` unless a later spec says otherwise; rules out inheriting review `role_stalled` retry semantics on open-ended implement.
- Out of scope: what work survives a stalled iteration (`commit-each-write-iteration`, write-path resume sibling of review stall recovery).
- Out of scope: why an agent goes quiet.

## Acceptance criteria

- [ ] A write-loop test drives a silent agent past the idle budget and asserts the iteration settles `idle_output_timeout` — not `iteration_timeout` — well before the iteration wall elapses; fails against the pre-fix code.
- [ ] `run list` / `run wait` report `outcomeKind` and `error.reason` `idle_output_timeout` (distinct from `iteration_timeout`), carrying agent, model, and the bound that fired.
- [ ] Plan-draft and intent-split workflow tests each drive a silent agent and assert `idle_output_timeout` (not `iteration_timeout`), so coverage is not implement-only.
- [ ] A write-loop test drives a silent token or blocker reprompt and asserts `idle_output_timeout`; omitting `idleOutputMs` on reprompt invoke sites fails the test.
- [ ] A write-loop test drives a healthy completing iteration and asserts no stall and no timeout outcome; inverting the watchdog arms fails the test.

## Documentation updates

- `v2/docs/write-behavior.md` — idle budget alongside progress-extended wall and ceiling; which bound fires when.
- `v2/docs/daemon-host.md` — `idle_output_timeout` outcome: reason, retryability, `nextAction`.
- `v2/docs/install-and-config.md` — `idleOutputTimeoutMs` on the write path and ordering with wall/ceiling.
- `v2/docs/operator-runbook.md` — remove the claim that v2 write has no idle-output watchdog (only `iterationTimeoutMs`).
- `v2/docs/v1-behaviors.md` — v2 write-loop idle-output watchdog parity with v1.

## Prerequisites

- Shared invocation aborts with `result.kind === "stall"` when stdout/stderr are idle longer than the supplied `idleOutputMs` budget.
- Review role invocations arm an idle-output budget and surface `failureKind: "stall"` with agent, model, and bound attribution.
- Write-loop iterations use a progress-extended wall clock with a hard ceiling, and machine config rejects inverted idle/wall/ceiling ordering at load.
