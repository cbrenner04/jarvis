---
name: review-roles-ignore-the-configured-idle-budget
---

# Review roles ignore the configured idle-output budget

## Problem

`idleOutputTimeoutMs` in `config/machines/<profile>.json` reads as a machine-wide idle budget, and
`resolveWritePathIterationBounds` resolves it. But `v2/src/commands/workflow.ts:142-148` applies
those bounds to **write** steps only:

```ts
step.behavior === "write"
  ? { ...step, ...bounds }                              // idleOutputMs applied
  : step.behavior === "review" || step.behavior === "review-debate"
    ? { ...step, roleTimeoutMs: reviewRoleTimeoutMs }    // idleOutputMs never set
    : step,
```

Review and review-debate steps therefore never carry `idleOutputMs`, so
`review-role-invocation.ts:42` falls back to its own hardcoded
`DEFAULT_IDLE_OUTPUT_TIMEOUT_MS = 90_000` on every invocation. Raising the machine-config value
does nothing for review roles, silently. Same class as the `JARVIS_READY_TIER` stomp: a documented
lever that has no effect on part of the system.

## Evidence (2026-07-26)

`config/machines/home.json` was set to `idleOutputTimeoutMs: 240000` after a write-step stall
(#2197). The very next `workflow-detach-after-admission` implement run then settled
`idle_output_timeout` **on its review step**, leaving 7 dirty files and 1 commit. The write step had
survived on the raised budget; the review step died on the unraised 90 s one, in the same run.

That spec has now failed twice — once `iteration_timeout`, once `idle_output_timeout` — and neither
failure was recoverable (`resumable: false`, `nextAction: "stop"`).

## Decisions

- Review and review-debate steps receive the configured idle budget from the same machine-config
  resolution the write path uses. Rules out a second, review-specific config key — one machine-wide
  idle budget, one place to set it.
- `review-role-invocation.ts`'s hardcoded default remains only as the no-config fallback, matching
  the write path's behavior when the key is unset. Rules out deleting the default outright.
- `0` disables the watchdog for review roles exactly as it does for the write path. Rules out
  diverging the disable semantics between the two.
- Do not change the default value in this work. Rules out folding a tuning decision into a
  plumbing fix — 90 s may well be wrong for review roles, but that is a separate, measured call.

## Acceptance criteria

- [ ] A review step built by `workflow.ts` carries `idleOutputMs` from machine config; a test
      asserts the resolved step and fails against the current write-only application.
- [ ] The same holds for a review-debate step.
- [ ] With `idleOutputTimeoutMs` unset, review roles still use the 90 s default; a test asserts the
      fallback is unchanged.
- [ ] With `idleOutputTimeoutMs: 0`, the review-role watchdog is disabled, matching the write path;
      a test asserts it.
- [ ] A review-role invocation observes the configured budget rather than the hardcoded default; a
      test drives the invocation path, not just step construction.
- [ ] Write-step bound application is unchanged; existing coverage stays green.
- [ ] Inverting the new wiring (dropping `idleOutputMs` from review steps) turns the first test RED.

## Documentation updates

- `v2/docs/agent-model-config.md` — `idleOutputTimeoutMs` applies to write **and** review roles.
- `v2/docs/operator-runbook.md` — correct the § Choosing an actuator note, which currently implies
  the configured budget governs review-role invocations; note the pre-fix behavior so an operator
  reading an old `role_stalled` knows which budget was in force.
