# 00 Cleanup admission queries only the stable socket

## Problem

`createBulkCleanupDaemonClient` (`v2/src/commands/cleanup.ts`, backing `cleanup --abandon` and bulk worktree-retirement eligibility) discovers every live digest-keyed daemon socket on the host via `discoverLiveDaemonSockets`/`queryDaemonListsFromSockets` and merges their `list` responses, preferring any row reported `isLive`. A stray or leftover live socket (a manually started daemon, an old generation still mid-drain) can therefore override the stable daemon's own answer for a run's liveness and corrupt an eligibility decision.

`v2/src/cli.ts` already dispatches every client request to the stable socket; its executable-digest computation names only the private successor socket a new `daemon start` hands its predecessor through during upgrade handoff (`v2/src/daemon/stable-digest-trigger.ts`), not a client routing target — that path is unaffected by this subspec. `v2/src/execution/runtime-smoke-verifier.ts` already targets the stable socket and computes no digest; unaffected.

## Decisions

- `createBulkCleanupDaemonClient` queries only `deps.socketPath` (the stable socket); no discovery, no cross-socket merge. The stable daemon's own `list` already folds a draining predecessor's live runs into its answer (see Prerequisites), so this preserves abandon-safety without a client-side merge.
- CLI bootstrap's executable-digest resolution stays scoped to `daemon start`'s private successor socket; not touched here.
- `reapDeadDaemonSockets`/`DAEMON_DIGEST_ARTIFACT_FILE` (`v2/src/commands/daemon.ts`) dead-socket-artifact reaping stays: it deletes leftover files, it does not route a command to a daemon, so it is outside this subspec's (and the structural guard's) "locate a daemon" scope.
- No fallback: `cleanup --abandon` and bulk eligibility fail closed (report the daemon unreachable / treat affected worktrees as ineligible) when the stable socket doesn't answer, rather than falling back to any other socket.
- `cleanup.test.ts` cases pinning cross-socket merge (`older-digest live daemon makes merged worktree ineligible`, `one dead socket in query set does not blank eligibility when another reports live run`) are rewritten to the stable-socket contract, not kept as parallel cases.

## Acceptance criteria

- [ ] A command test proves worktree eligibility for `cleanup --abandon`/bulk cleanup reflects only the stable daemon's run data, even when another live digest-keyed socket on the host reports a conflicting `isLive` answer for the same project+branch; it fails against the pre-fix cross-socket merge in `createBulkCleanupDaemonClient` (`v2/src/commands/cleanup.ts`).
- [ ] A test proves `cleanup --abandon`/bulk cleanup still refuses to retire a worktree with a live run the stable daemon reports on behalf of a draining-generation daemon (unchanged: the stable `list` already folds in draining-owned runs).
- [ ] A test proves `cleanup --abandon`/bulk cleanup fails closed (reports the daemon unreachable, no eligible worktrees) when the stable socket doesn't answer, rather than falling back to any other discovered socket.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — § Fail-closed daemon reads and digest artifact reaping: cleanup queries the stable socket only, not every discovered socket; `--abandon <name>` connects to the stable socket.
- `v2/docs/first-workflow-walkthrough.md` — replace the "daemon keyed by the invoking executable" auto-start language and the `socketKey` JSON example with the stable daemon/socket contract.
- `v2/docs/v1-behaviors.md` — replace the cleanup cross-socket-query behavior entry with the stable-socket contract.
