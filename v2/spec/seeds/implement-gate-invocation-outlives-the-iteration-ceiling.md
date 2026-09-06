---
name: implement-gate-invocation-outlives-the-iteration-ceiling
---

# Concurrent implement lanes each run the full suite inside their own iteration budget, so every lane dies at the ceiling with only the test AC outstanding

## Problem

An implement subspec's last acceptance criterion is almost always `bun run test:v2` (or the matching slice). The agent satisfies the cheap criteria first, then invokes the suite **inside the write step's iteration budget**. Nothing bounds, staggers, or accounts for that invocation against `iterationTimeoutMs`, and nothing coordinates it across concurrent lanes — every live implement lane runs its own full suite whenever it happens to reach that criterion.

The aggregate suite is ~326s on an idle machine. Under three-to-four concurrent implement lanes it does not finish inside the 45-minute ceiling, so the iteration is killed mid-suite.

Two consequences compound:

1. **The lane dies with exactly one AC unticked — the test one.** Everything else is ticked and committed.
2. **That guarantees the run is non-resumable.** `hasCompletedSubspec` requires a subspec's non-human-only criteria to be *all* ticked. Because the test criterion is the one the agent ticks last and the one that consumes the budget, a lane killed during the suite always has zero fully-complete subspecs. So the `iteration_timeout` resume path is unreachable in precisely the case it exists for.

This is a distinct seam from [[subspec-inventory-relativizes-against-the-wrong-root]] (which makes the inventory empty regardless) and from [[concurrent-load-suite-margin-check]] (which pins the suite runner's own scheduling margin). Fixing either of those does **not** rescue these runs: the inventory fix reports the subspec as *remaining*, still not *completed*, so `resumable` stays false.

## Evidence (2026-09-06, two lanes, same session)

Four concurrent implement lanes. Load never exceeded ~11 and the watchdogs never false-killed — this is not the saturation mode the runbook's Concurrency section describes.

| Run | Branch | Iterations | Died at | Committed | Unticked AC |
| --- | --- | --- | --- | --- | --- |
| `8155c8e9` | `…-subspec-inventory-relativizes-worktree-root` | 1 | **45m01s** | 1 commit, +318 lines, clean tree, 15/16 ACs | `bun run test:v2` passes |
| `f229f8d7` | `…-daemon-start-reclaims-leftover-socket` | 2 | **45m02s** | 2 commits, subspec 00 at 8/9 ACs | `bun run test:v2` passes |

Both settled `iteration_timeout` / `resumable: false` / `nextAction: stop` with `completedSubspecPaths: []` and `remainingSubspecPaths: []`.

`f229f8d7` is the sharp case. Its iteration 1 committed subspec 00 and settled `progress`; iteration 2 then ran **45 minutes with `iteration_commit skipReason: "no_file_changes"`** — the whole budget spent inside a suite invocation that produced nothing, while two sibling lanes were doing the same thing.

The identical 45-minute death on two independent lanes, each with the test criterion as the sole survivor, is the signature.

## Decisions

- The agent's own gate invocation is accounted for against the iteration budget explicitly, rather than silently consuming it; a gate invocation that cannot fit the remaining budget is not started; rules out discovering the overrun only as a mid-suite kill.
- Full-suite invocations are serialized across concurrent implement lanes on one machine, the way `MAX_CONCURRENT_VERIFIER_TEST_RUNS` already bounds verifier subprocesses; rules out N lanes each independently saturating the machine with the same suite.
- A lane killed inside a gate invocation settles as resumable when its non-test criteria are complete and the only outstanding criterion is the gate itself; rules out the ordering interaction that makes `hasCompletedSubspec` structurally false for exactly this failure.
- The settlement names the gate invocation as the cause and reports how long it ran; rules out a bare `iteration_timeout` that reads identically to an agent that stalled.
- Rules out raising `iterationTimeoutMs` as the fix: the overrun scales with lane count, so any fixed ceiling is beaten by one more lane.

## Acceptance criteria

- [ ] A test proves a write step whose remaining budget cannot accommodate a gate invocation refuses to start it and settles with a named cause, rather than being killed mid-invocation; it fails against the current unaccounted invocation.
- [ ] A test proves concurrent implement lanes on one machine do not run full-suite gate invocations simultaneously; it fails against the current uncoordinated invocation.
- [ ] A test proves a lane killed during a gate invocation, whose every non-gate criterion for the active subspec is ticked, settles `resumable: true`; it fails against the current `hasCompletedSubspec` all-criteria rule.
- [ ] A test proves the settlement distinguishes a gate-invocation overrun from an agent stall in `loop_finished` output; it fails against the current undifferentiated `iteration_timeout`.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — § Concurrency: the ceiling is concurrent full-suite gate invocations, not lane count; record the 45-minute signature and that load average does not predict it.
- `v2/docs/write-behavior.md` — gate-invocation budget accounting and the resumability rule for a gate-only outstanding criterion.
- `v2/docs/v1-behaviors.md` — record gate-invocation serialization across lanes.
