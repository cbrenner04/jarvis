---
name: ready-gate-reaps-test-children
---

# Ready gate spawns its test invocation in a killable group and reaps it on run termination

## Prerequisites

- The shared async subprocess runner can spawn a call in its own process group and signal the whole group on abort.
- The shared async subprocess runner exposes the spawned group id to the caller.

## Behavior

The ready gate's `bun run ready` invocation (and the required-integration invocation it drives) spawns in its own process group and is bound to the run's termination signal. When a run is killed, abandoned, hits an iteration timeout, or settles after daemon loss while the gate is mid-flight, the gate's whole test process tree is signaled — no `bun test` descendant survives. Today the gate call passes no signal, so termination unwinds the harness and leaves the test tree running for days.

The owning run records the gate's process group id durably while the gate is in flight and clears it when the gate settles, so a later sweep can identify a group whose run no longer exists. A group id belongs to exactly one run.

Scope is the gate's test invocation only: test selection, scope derivation, gate classification, and repair behavior are unchanged.

## Acceptance criteria

- [ ] Terminating a run whose ready gate is mid-flight leaves no surviving test descendant; a regression drives a run to the gate, terminates it, and asserts the spawned group is gone.
- [ ] The gate spawns in group mode, pinned by a test inspecting the spawn options passed to the runner.
- [ ] The in-flight gate's group id is recorded durably for the owning run and cleared on gate settlement (success and failure alike), pinned by a test.
- [ ] A gate that completes normally is unaffected: same command, args, env, and classification, pinned by an existing-behavior test.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — killed, abandoned, and timed-out runs reap their ready-gate test children; drop any standing "manually kill leaked bun test" gotcha.
