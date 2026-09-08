---
name: implement-gate-invocation-iteration-budget
---

# Implement gate invocations account against the iteration budget

## Primary implementation surface

execution-loop — agent gate-invocation budget accounting, cross-lane serialization, `iteration_timeout` resumability, and `loop_finished` settlement in `v2/src/execution/write-loop.ts`

Unsplit rationale: Budget preflight, machine-wide gate serialization, gate-only resumability, and named gate-invocation timeout settlement are one write-step iteration contract; no persistence, daemon, or CLI surface owns agent-initiated full-suite invocations or their timeout recovery.

## Problem

An implement subspec's last acceptance criterion is usually `bun run test:v2` (or the matching slice). The agent satisfies cheaper criteria first, then invokes the suite inside the write step's iteration budget. Nothing accounts for that invocation against `iterationTimeoutMs`, nothing serializes it across concurrent lanes, and a mid-suite kill leaves exactly one AC unticked — the test one — with `hasCompletedSubspec` false, so `iteration_timeout` settles non-resumable despite all other work committed.

## Decision ledger

- Agent-initiated full-suite gate invocations are accounted against the remaining write-step iteration budget before start; an invocation that cannot fit is refused with a named cause rather than started; rules out discovering the overrun only as a mid-suite kill.
- Full-suite gate invocations serialize machine-wide across concurrent implement lanes via a module constant cap patterned on `MAX_CONCURRENT_VERIFIER_TEST_RUNS`; rules out N lanes each independently saturating the machine with the same suite.
- `iteration_timeout` with every non-gate criterion for the active subspec ticked and only the gate criterion outstanding settles `resumable: true`; rules out requiring all criteria ticked for resume in exactly this failure shape.
- Gate-invocation `iteration_timeout` names the gate on `loop_finished` and reports elapsed gate time; rules out undifferentiated `iteration_timeout` indistinguishable from agent stall.
- Rules out raising `iterationTimeoutMs` as the fix; overrun scales with lane count so any fixed ceiling is beaten by one more lane.

## Acceptance criteria

- [ ] `write-loop.test.ts` proves a write step whose remaining budget cannot accommodate a gate invocation refuses to start it and settles with a named cause; it fails against the current unaccounted invocation.
- [ ] `write-loop.test.ts` proves concurrent implement lanes on one machine do not run full-suite gate invocations simultaneously; it fails against the current uncoordinated invocation.
- [ ] `write-loop.test.ts` proves a lane killed during a gate invocation with every non-gate criterion for the active subspec ticked settles `resumable: true`; it fails against the current all-criteria `hasCompletedSubspec` rule.
- [ ] `write-loop.test.ts` proves gate-invocation overrun `loop_finished` output names the gate and elapsed time, distinguishable from agent stall; it fails against the current undifferentiated `iteration_timeout`.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — § Concurrency: the ceiling is concurrent full-suite gate invocations, not lane count; record the 45-minute signature and that load average does not predict it.
- `v2/docs/write-behavior.md` — gate-invocation budget accounting, cross-lane serialization, gate-only resumability, and named gate-invocation timeout settlement.
- `v2/docs/v1-behaviors.md` — record gate-invocation budget accounting and serialization across implement lanes.

## Prerequisites
