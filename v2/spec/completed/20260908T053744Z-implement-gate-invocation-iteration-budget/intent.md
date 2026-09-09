---
name: implement-gate-invocation-iteration-budget
---

# Implement gate invocations account against the iteration budget

## Primary implementation surface

execution-loop — agent gate-invocation budget accounting, cross-lane serialization, `iteration_timeout` resumability, and `loop_finished` settlement in `v2/src/execution/write-loop.ts`

Unsplit rationale: Budget preflight, machine-wide gate serialization, gate-only resumability, and named gate-invocation timeout settlement are one write-step iteration contract; no persistence, daemon, or CLI surface owns agent-initiated full-suite invocations or their timeout recovery.

## Problem

An implement subspec's last acceptance criterion is usually `bun run test:v2` (or the matching slice). The agent satisfies cheaper criteria first, then invokes the suite inside the write step's **iteration ceiling** (`iterationCeilingMs`). Nothing accounts for that invocation against remaining ceiling headroom, nothing serializes it across concurrent lanes, and a mid-suite kill leaves exactly one AC unticked — the test one — with the active subspec still in `remainingSubspecPaths`, so `hasCompletedSubspec` (`completedSubspecPaths.length > 0`) is false and `iteration_timeout` settles non-resumable despite all other work committed.

Operator evidence (2026-09-06): two independent lanes died at **45m01s/45m02s** with only `bun run test:v2` outstanding and `completedSubspecPaths: []`. Complementary to shipped [[subspec-inventory-relativizes-worktree-root]] — that fix reports inventory correctly but does not bound or stagger gate invocations, and an incomplete subspec with only the gate AC unticked still lands in `remaining`, not `completed`.

## Decision ledger

- **Gate-invocation detection:** classify an agent shell subprocess as a full-suite gate invocation when its command matches `/^bun run test(?::|$)/` — the same predicate `ready-finalize.ts` uses for ready-gate test commands; rules out treating ordinary shell work (typecheck, file-scoped `bun test`, git) as gate traffic.
- **Budget reservation:** before start, reserve `TEST_STEP_BUDGET_MS` (`scripts/ready.ts`, 15 minutes) against remaining `iterationCeilingMs` headroom (elapsed since `iteration_started`); refuse when headroom is insufficient; active gate time accrues against the ceiling timer that killed the operator lanes, not the re-arming wall segment alone; rules out discovering overrun only as a mid-ceiling kill.
- **Serialization cap:** `MAX_CONCURRENT_AGENT_GATE_INVOCATIONS = 1` in `write-loop.ts` with a module semaphore (patterned on `MAX_CONCURRENT_VERIFIER_TEST_RUNS` but cap 1 for machine-wide mutual exclusion); rules out N lanes each independently saturating the machine with the same suite.
- **Gate-criterion identification:** a non-human-only acceptance criterion is a gate criterion when its checklist text names a full-suite `bun run test:*` command — the same meta-verification commands `scripts/ci-test-scope.ts` surfaces (`bun run test:v2`, `bun run test:integration:v2`, and sibling shared slices); rules out treating typecheck or file-scoped test ACs as gate criteria.
- **Settlement shape:** preflight refusal settles `loopOutcomeKind: "gate_invocation_refused"` with `gateCommand` on `loop_finished`; ceiling kill during an active gate keeps `iteration_timeout` but adds `gateInvocationCommand` and `gateInvocationElapsedMs` on `loop_finished` (omitted on agent-stall timeout); rules out undifferentiated `iteration_timeout` and unnamed refusal.
- `iteration_timeout` with every non-gate criterion for the active subspec ticked and only the gate criterion outstanding settles `resumable: true`; rules out requiring a fully completed subspec (`completedSubspecPaths`) for resume in exactly this failure shape.
- Rules out raising `iterationCeilingMs` as the fix; overrun scales with lane count so any fixed ceiling is beaten by one more lane.

## Acceptance criteria

- [ ] `write-loop.test.ts` proves a write step whose remaining `iterationCeilingMs` headroom cannot accommodate a gate invocation refuses to start it and settles `loopOutcomeKind: "gate_invocation_refused"` with `gateCommand` on `loop_finished`; it fails against the current unaccounted invocation.
- [ ] `write-loop.test.ts` proves concurrent implement lanes on one machine do not run full-suite gate invocations simultaneously under `MAX_CONCURRENT_AGENT_GATE_INVOCATIONS = 1`; it fails against the current uncoordinated invocation.
- [ ] `write-loop.test.ts` proves a lane killed during a gate invocation with every non-gate criterion for the active subspec ticked settles `resumable: true`; it fails against the current incomplete-subspec inventory rule where any unchecked non-human-only criterion keeps the subspec in `remainingSubspecPaths`.
- [ ] `write-loop.test.ts` proves gate-invocation ceiling `loop_finished` output carries `gateInvocationCommand` and `gateInvocationElapsedMs` while agent-stall `iteration_timeout` omits them; it fails against the current undifferentiated `iteration_timeout`.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — § Concurrency: document post-fix operator semantics — one concurrent full-suite gate invocation machine-wide, preflight refusal when ceiling headroom is insufficient, and gate-only-outstanding resume — not a re-record of the pre-fix 45-minute death signature.
- `v2/docs/write-behavior.md` — gate-invocation detection, `TEST_STEP_BUDGET_MS` ceiling preflight, cross-lane serialization (`MAX_CONCURRENT_AGENT_GATE_INVOCATIONS`), gate-only resumability, and `gate_invocation_refused` / enriched `iteration_timeout` settlement fields.
- `v2/docs/v1-behaviors.md` — record gate-invocation budget accounting and serialization across implement lanes.

## Prerequisites
