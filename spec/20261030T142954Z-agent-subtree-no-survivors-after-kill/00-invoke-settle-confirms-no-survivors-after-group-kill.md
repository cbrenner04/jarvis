# Invoke settle confirms no survivors after armed group kill

Production incident: after `idle_output_timeout`, implement run `147dca0f-b4c1-4348-b414-b1bc98546975` settled while the cursor agent and five detached-pgid bash tool shells stayed at 100% CPU. Prior work arms descendant snapshot, SIGTERM, and scheduled SIGKILL in `singleSpawn` (`20261001T023250Z-agent-abort-reaps-descendant-groups`), but something on that path still allows live processes when the binding promise resolves.

## Decision ledger

- Reproduce first in `src/shared/invocation/agents.test.ts` with a fake agent that emits output then goes idle, real-spawns a detached-pgid child that ignores SIGTERM (`trap '' TERM; while :; do :; done`), and drives idle stall with `joinProcessOnIdleStall` — rules out landing a fix without a failing regression (reachable gap: `idle stall with joinProcessOnIdleStall SIGTERMs descendant process groups` stops at SIGTERM and never asserts SIGKILL or live-process checks).
- Fix only the existing `killProcessGroup` / invoke-settle coordination inside `src/shared/invocation/agents.ts` — rules out a parallel reaper or daemon-only sweep for in-flight invocations.
- Invariant: every path that already arms group kill (operator abort, iteration-timeout `AbortSignal`, idle stall with `joinProcessOnIdleStall`) must SIGKILL each snapshotted pgid after `abortKillGraceMs` and leave no live member of those groups before the binding invoke promise resolves — rules out treating leader `close` or immediate stall settlement as sufficient while foreign groups ignore SIGTERM.
- Deferred to first consumer: exact settle/kill sequencing inside `singleSpawn` (await escalation vs defer `settle()` vs confirm group liveness) — pin when the reproduction test identifies which branch fails on main.

## Out of scope

- Reaping hung tool shells while the agent invocation is still running and has not armed group kill.
- Run-row recorder clear timing (subspec 01).

## Task checklist

- [ ] Add the reproduction regression in `src/shared/invocation/agents.test.ts` (short `abortKillGraceMs`; real child process; assert SIGKILL per snapshotted pgid and group liveness failure for each pgid when invoke settles).
- [ ] Identify and fix the gap on the armed-kill path so escalation completes and invoke settle observes an empty snapshotted subtree.
- [ ] Keep injectable spawn, probe, group-signal, and timer seams; do not read ambient machine config in tests.

## Acceptance criteria

- [ ] `src/shared/invocation/agents.test.ts` adds a regression where a fake agent idle-stalls with output, spawns a detached-pgid child ignoring SIGTERM, uses `joinProcessOnIdleStall`, and asserts every snapshotted pgid receives SIGKILL after `abortKillGraceMs` with no live processes in those groups when invoke settles; fails against main (reachable via `idle stall with joinProcessOnIdleStall SIGTERMs descendant process groups`, which stops at SIGTERM).
- [ ] `src/shared/invocation/agents.test.ts` test `SIGKILL escalation survives leader settlement for remaining descendant groups` stays green.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:agent` passes.

## Documentation updates

- None in this subspec (shared-invocation and v1 catalog updates live in subspec 01 alongside recorder-clear semantics).
