---
name: gate-slot-refusal-is-a-resume-treadmill
---

# The one-gate-per-daemon slot refuses instead of queueing, so fan-out becomes operator resume work

## Problem

`acquireGateInvocationLease` admits while live leases are below `MAX_CONCURRENT_AGENT_GATE_INVOCATIONS` (1) and otherwise returns nothing, and the lane settles `gate_invocation_refused` — `runStatus: "failed"`, `resumable: true`, `nextAction: "resume"`. Refusing rather than queueing is a stated decision in [`write-behavior.md`](../../docs/write-behavior.md), with a real reason: the agent CLI has already announced the Bash call, so the harness cannot hold it open.

The decision is sound at the invocation layer and wrong at the operator layer. Nothing rate-limits *dispatch* to the number of gate slots, and nothing re-drives a refused lane when a lease frees. So every implement lane past the first that reaches its gate fails, and the only recovery is an operator typing `jarvis run resume` — which re-enters the same contended slot and can refuse again immediately. Fan-out is admitted freely and then converted into hand work, one row at a time, with no signal about when a retry would succeed.

This is the operator-visible residue of the fix for [[coscheduled-test-pair-strands-runs-terminally]]. That fix was a real improvement — a refusal beats the 45-minute `iteration_timeout` it replaced, and no work is lost. But the harness now admits a fan-out it structurally cannot serve.

## Evidence (2026-09-11)

Five concurrent implement lanes on one daemon, load 11–17, zero watchdog kills and zero idle-output stalls — lane count and load were both fine. Four lanes settled `gate_invocation_refused`:

| Branch | `gateCommand` |
| --- | --- |
| `20260910T230153Z-surviving-mutation-settlement-records-killing-set` | `bun run test:v2 2>&1 \| tail -80` |
| `20260911T021740Z-handoff-daemon-generations-at-stable-address` | `bun run test:v2 2>&1 \| tail -80` |
| `20260911T141706Z-glob-patterns-are-not-artifact-paths` | `bun run test:shared 2>&1 \| tail -80` |
| `20260910T231516Z-settle-workflows-with-falsifiable-failures` | `bun run test:shared 2>&1 \| tail -60` |

`20260911T141706Z-glob-patterns-are-not-artifact-paths` was resumed and refused a second time, which is the treadmill: resume is the documented recovery and it has no better odds than the dispatch that just failed.

## Decisions

- A lane refused for the **slot** (not for ceiling headroom) is re-driven by the daemon when a lease is released, without an operator command. Slot contention is transient and the daemon owns the lease set, so it knows exactly when the condition clears. Rules out leaving a transient, harness-known condition as hand work.
- Ceiling-headroom refusals keep today's behavior and stay operator-resumable. That condition is not transient — re-driving it would spin. Rules out collapsing two different causes into one recovery.
- `gate_invocation_refused` distinguishes the two causes on the durable row, and `jarvis run list` / `wait` name which one. Today both settle the same reason with the same `nextAction`, so an operator cannot tell a wait-and-retry from a re-dispatch. Rules out an auto-retry the operator cannot observe or reason about.
- Bound the re-drive: a lane is re-driven for slot contention a fixed number of times before settling for the operator, and each re-drive is visible in the run log. Rules out an unbounded internal retry loop.
- Out of scope: raising `MAX_CONCURRENT_AGENT_GATE_INVOCATIONS`, admission-time throttling of how many implement lanes may be dispatched, and any change to how the lease itself is acquired or released.

## Acceptance criteria

- [ ] A write-path test proves a lane refused because the slot was held is re-driven when the holder releases its lease, and reaches its gate without an operator command; it fails against the current settle-and-stop behavior.
- [ ] A test proves a lane refused for insufficient ceiling headroom is *not* re-driven and settles `gate_invocation_refused` for the operator exactly as today.
- [ ] A test proves the durable settlement and the `jarvis run list` / `jarvis run wait` operator error name which cause produced the refusal, and that the slot cause reports its re-drive count; it fails against the current single undifferentiated reason.
- [ ] A test proves slot re-drives are bounded: a lane that exhausts the bound settles for the operator with the bound named, and the run log records each re-drive.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — the lease section states that slot refusals are re-driven by the daemon and headroom refusals are not, with the bound.
- `v2/docs/operator-runbook.md` — § Concurrency: `gate_invocation_refused` is operator work only for the headroom cause; correct the recovery line that currently names `jarvis run resume` for both.
- `v2/docs/v1-behaviors.md` — record the split cause and the bounded re-drive.
