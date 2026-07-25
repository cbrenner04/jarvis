# 00 - Escalate review-role wall-clock timeout through remaining rungs

## Problem

`invokeReviewRole` (`v2/src/execution/review-role-invocation.ts`) arms one
wall-clock timer and calls `executeWithQuotaFallback` once over the full binding
list. When the timer fires, it returns `roleTimeout` from the in-flight binding
even when later bindings remain — the same seam that left `claude.actuator`'s
declared sonnet rung unreachable while opus hit the bound twice. Quota still
walks the flat list; role timeout does not.

## Decisions

- Advance to the next binding in the supplied flat list on role wall-clock timeout
  when another binding follows; rules out settling `roleTimeout` from the first
  timed-out attempt while later rungs exist.
- Wall-clock escalation composes with quota: each outer segment is one
  `executeWithQuotaFallback` over the binding **suffix** from the next unconsumed
  index (not one binding per outer loop that severs quota’s in-list walk); rules
  out reimplementing quota inside the timeout loop.
- On role timeout during an in-flight quota walk, the timed-out binding is
  current, segment `attempts` stay on the merged execution, and the next segment
  starts at the next index without re-invoking bindings already consumed in that
  segment.
- Each binding attempt gets its own fresh `roleTimeoutMs` timer; worst-case wall
  time scales with rung count (N × bound); rules out one shared wall clock across
  the whole role invocation.
- Each binding attempt resets the idle-output / `stall` budget (`idleOutputMs`)
  the same way; rules out an early hang consuming a later rung’s idle budget.
- Escalation stays inside one `invokeReviewRole` call; rules out re-running
  earlier workflow steps to reach the next rung.
- `ok` on any attempt stops without invoking further bindings; rules out
  unconditional rung consumption after success.
- Quota-driven advancement inside `executeWithQuotaFallback` is unchanged;
  rules out folding quota semantics into the timeout loop.
- Caller-signal abort (pause/kill) does not advance rungs; rules out treating
  every aborted invocation as timeout escalation.
- Idle-output `stall` escalation is unchanged; rules out coupling stall and
  wall-clock policies in this slice.

## Task checklist

- Outer timeout loop in `invokeReviewRole`: on role timer timeout (not caller
  abort), start the next segment at the next binding index when present; terminal
  `roleTimeout` only after the last binding times out.
- Per segment, call `executeWithQuotaFallback` on the remaining suffix so quota
  still walks that suffix in order; merge `attempts` (and telemetry) across
  segments on the returned execution.
- Preserve attempt history on the returned `InvocationExecution` across timeout
  advances (consistent with quota fallback records).
- Extend `review-role-invocation.test.ts` for multi-binding timeout escalation,
  quota-then-success in one call, success-without-extra-rung, and per-segment
  idle reset where needed.

## Acceptance criteria

- [ ] A new test in `v2/src/execution/review-role-invocation.test.ts` supplies two
      bindings where the first hangs until `roleTimeoutMs` and the second
      completes with `ok`; it asserts the role succeeds on the second binding and
      records both attempts; it fails against the pre-fix code, which settles
      `roleTimeout` on the first binding.
- [ ] A new test in `v2/src/execution/review-role-invocation.test.ts` drives the
      first binding to `quota` and the second to `ok` in one `invokeReviewRole`
      call (no wall-clock timeout) and asserts success on the second binding with
      both bindings invoked once; it fails if outer timeout escalation breaks
      quota’s in-list walk.
- [ ] A test in `v2/src/execution/review-role-invocation.test.ts` drives a role
      that completes on the first binding and asserts no further binding is
      invoked (single successful attempt); inverting the early-exit guard fails
      the test.
- [ ] Tests fail when each added or modified guard is inverted; where a guard
      suppresses escalation (caller abort, success on current rung), the negative
      case proves the next binding is not invoked.
- [ ] `shared/invocation/execute.test.ts` (`advances only on quota and preserves binding order`) stays green.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/agent-model-config.md` — role-invocation wall-clock overrun advances
  through the flat binding list alongside quota; note per-rung `roleTimeoutMs`
  and idle budgets (worst-case N × bound).
- `v2/docs/workflow-runner.md` — per-role wall clock escalates through remaining
  rungs before settle.
- `v2/docs/v1-behaviors.md` — review-role timeout now walks configured rungs
  before terminal failure.
