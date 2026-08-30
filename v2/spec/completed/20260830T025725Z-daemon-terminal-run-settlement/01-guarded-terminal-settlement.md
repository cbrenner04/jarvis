# Settle guarded kill and reconciliation atomically

Authoritative for daemon-owned guarded terminal settlement: acceptance criteria, documentation updates, and material decisions in this file supersede `intent.md` where they differ.

## Problem

Active and forced kill still terminate through `commitGuardedKill`, while startup reconciliation makes orphan rows terminal inside `beginRunReconciliation`. Neither daemon-owned path routes its admitted transition through the atomic terminal-settlement operation.

## Decision ledger

- Daemon evaluates active-run, boundary-terminal, force, owner-liveness, and orphan-liveness admission before calling terminal settlement; rules out moving daemon policy into the persistence primitive or making guarded no-ops unconditional.
- Admission and the synchronous settlement call have no event-loop yield between the final durable-status check and write; rules out a same-process completion boundary interleaving between guard and settlement.
- Concurrent or repeated reconciliation preserves a boundary-terminal winner and does not re-settle or re-time an already terminal row; rules out weakening restart idempotence while moving terminal ownership to the daemon.
- Startup reconciliation still chooses `interrupted` for durable review-debate rows and `killed` for other admitted orphan statuses, retains `reconciliation_pending` retry semantics, and preserves attempt/reconciliation finish metadata needed by existing observers; rules out flattening review interruption or losing crash-after-status log recovery.
- Kill and restart reconciliation omit `terminalCause` and `terminalFailureDetail` because the current settlement schema has no honest `WriteLoopOutcomeKind` or `InvocationFailureDetail` representation for operator kill or `daemon_restart`; rules out misclassifying them as invocation failures merely to populate optional columns.
- Workflow kill remains deferred until invocation and repair quiescence, and terminal settlement precedes registry release; rules out exposing same-key admission before killed is durable.
- Execution-owned `commitCompletionBoundary` calls under `v2/src/daemon/` remain for the execution settlement intent; rules out overlapping the dependent completion-boundary migration.

## Tasks

- Replace daemon production use of `commitGuardedKill` with daemon-owned guarded admission followed by `commitTerminalRunSettlement({ status: "killed" })` for active write runs, deferred workflow kills, and admitted forced kills.
- Separate startup orphan admission from its terminal write so `reconcileOrphanedRuns` submits each admitted `killed` or `interrupted` transition through `commitTerminalRunSettlement`, retaining pending-event retry and reconciliation finish bookkeeping without another production terminal writer.
- Preserve force owner-liveness refusal, boundary-terminal precedence, duplicate-sweep idempotence, startup ordering, recovery admission, worktree retention, abort, and ownership release.
- Remove daemon production calls to `commitGuardedKill`, terminal `setRunStatus`, and reconciliation-owned terminal writes; leave nonterminal writes and execution-owned completion boundaries in place.
- Add focused kill and restart regressions that fail against the legacy writers and prove immediate durable observation after settlement.
- Update the durable docs below.

## Acceptance criteria

- [x] `v2/src/daemon/daemon-start-list.test.ts` test `active deferred and forced kill use terminal settlement after admission` covers all three daemon kill emitters, proves each admitted row is immediately `killed` with finish metadata through `commitTerminalRunSettlement`, and fails against the pre-fix `commitGuardedKill` calls.
- [x] `v2/src/daemon/daemon-start-list.test.ts` tests `kill preserves boundary-terminal status on an active run but still aborts`, `kill without force still rejects a non-active paused run`, `kill with force leaves terminal rows unchanged`, and live/dead foreign-owner force cases stay green (guard and liveness behavior unchanged).
- [x] `v2/src/daemon/daemon-reconciliation.test.ts` test `startup reconciliation routes admitted orphan terminals through atomic settlement` proves ordinary orphans settle `killed`, durable review-debate orphans settle `interrupted`, immediate store/list reads carry terminal status and finish metadata, and the test fails against the pre-fix reconciliation-owned terminal write.
- [x] `v2/src/daemon/daemon-reconciliation.test.ts` live-owner, current-owner, boundary-terminal, pending-event retry, duplicate-event suppression, finish-source, and automatic recovery tests stay green (startup admission, idempotence, and recovery unchanged).
- [x] A production-source audit test under `v2/src/daemon/` fails if daemon run termination calls `setRunStatus` with a terminal status, `commitGuardedKill`, or a reconciliation API that writes terminal run status; `commitTerminalRunSettlement` is the only daemon-owned terminal run writer, with the explicitly execution-owned `commitCompletionBoundary` call excluded.
- [x] Immediate `list` and `wait` after an admitted kill or reconciliation report the settled terminal status without requiring a later structured-log append; kill resumability and `run_reconciled` history remain unchanged.
- [x] `v2/docs/daemon-host.md`, `v2/docs/state-store.md`, and `v2/docs/v1-behaviors.md` document daemon admission versus persistence settlement ownership, guarded kill, owner-liveness, reconciliation pending/idempotence, optional evidence omission, and the remaining execution-owned boundary.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — guarded-kill and startup-reconciliation admission, atomic settlement, pending-event retry, immediate observation, and ownership-release ordering.
- `v2/docs/state-store.md` — reconciliation/kill helper changes, daemon-owned admission boundary, and removal of legacy daemon terminal writers from the production path.
- `v2/docs/v1-behaviors.md` — record atomic daemon kill/reconciliation settlement and preserved guards, liveness, and recovery semantics.
