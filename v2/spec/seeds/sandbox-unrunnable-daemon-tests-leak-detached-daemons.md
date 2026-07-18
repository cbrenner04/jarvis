# Seed: sandbox-unrunnable daemon tests leak detached daemon processes

## Problem

`v2/src/daemon/*.sandbox-unrunnable.test.ts` (e.g. `daemon.sandbox-unrunnable.test.ts`,
`daemon-start-list.sandbox-unrunnable.test.ts`) spawn real detached daemon processes
(`bun v2/src/daemon-entrypoint.ts`). When the test run is killed or the launching process exits, those
daemons survive: they reparent to PID 1 and keep running, bound to their test socket paths, pinning
resources. This is the daemon analogue of [[test-fixtures-survive-teardown-and-leak]].

Observed 2026-07-18: adversarial mutation-review subagents ran these tests from throwaway worktrees;
after the reviews finished (and the worktrees were removed), **five** leaked
`daemon-entrypoint.ts` processes remained (ppid 1, 45–50 min old), running from already-deleted
worktree paths. They accumulate with every review/test run that spawns them.

## Decisions

- Sandbox-unrunnable daemon tests must guarantee teardown of every daemon they spawn — `afterEach`/
  `afterAll` SIGKILL of the spawned daemon PID, and/or the daemon entrypoint should self-exit when its
  launching parent dies (detect ppid==1 or a parent-liveness heartbeat).
- Prefer that spawned test daemons never outlive their test process.

## Acceptance criteria

- [ ] After a full `test:integration:v2` run (including sandbox-unrunnable daemon tests) is completed or
      killed mid-run, no `daemon-entrypoint.ts` process spawned by the suite remains alive.
- [ ] `bun run typecheck`, `test:v2`, `test:integration:v2` pass.

## Documentation updates

- `v2/docs/test-writing.md` — spawned-daemon teardown requirement; and remove any operator-runbook
  stopgap that sweeps leaked test daemons once this ships.
