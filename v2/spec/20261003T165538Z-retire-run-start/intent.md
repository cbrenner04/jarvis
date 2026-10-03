---
name: retire-run-start
---

# Retire the run start command and write-loop persistence

## Problem

`run start` is the only producer of `ActiveRun` `kind: "write-loop"` rows with durable `queuedInput` (`daemon-run-lifecycle-handlers.ts`). It is superseded by `run workflow` as the sole user-facing write admission path. Supporting plumbing: `parseWriteCliInput` (`commands/write.ts`), `reconstructDirectWriteResume` (`daemon-run-lifecycle-handlers.ts`), and direct daemon `start` with `params.input`. `run.test.ts` `describe("keyed daemon auto-start on dispatch")` (five cases) and `run start dispatches without a preceding status request` under `dispatch to keyed daemons` must move to `run workflow` argv before the cut (`v2/src/cli/stale-dispatch.test.ts` already owns stale-dispatch). `resolveWriteSiblingCommandSource` (`workflow-runner-resume.ts`) still spreads `queuedInput` for fix/ready; subspec 03 limits that helper to snapshot steps after subspec 02 drops the column.

## Decisions

- Delete the `start` subcommand from the `run` command surface (`run.ts`).
- Delete `parseWriteCliInput` from `write.ts` (no callers remain).
- Delete `reconstructDirectWriteResume`; log-based `reconstructWriteResume` is the only paused write resume path.
- Delete `kind: "write-loop"` active-run ownership and `queuedInput` from the persisted `Run` shape in `v2/src/persistence/state-store.ts` — rules out `v2/src/daemon/store.ts` (not present).
- Port subspec 00 dispatch coverage to `run workflow` before subspec 01 deletes `run start` tests; other `describe("run start")` cases retire per subspec 01 collateral ledger — rules out ad-hoc auditing at delete time.
- In `resolveWriteSiblingCommandSource`, remove `queuedInput` from fix/ready command sources; snapshot step fields remain.
- Rules out deleting `queuedInput` before subspec 00 workflow dispatch parity lands.

## Prerequisites

- Retire `run pause` (`pauseController` / `pauseSignal` removed) (delivered by: retire-run-pause)

## Acceptance criteria

- [ ] `run start` is gone from `run --help` and `jarvis help run`.
- [ ] `grep -rn parseWriteCliInput v2/src --include='*.ts'` returns zero matches.
- [ ] `grep -rn reconstructDirectWriteResume v2/src --include='*.ts'` returns zero matches.
- [ ] `grep -rn 'kind: \"write-loop\"' v2/src/daemon --include='*.ts'` returns zero matches; reachable on main at `daemon-run-lifecycle-handlers.ts`, `daemon.ts`, `workflow-invocation-live.test.ts`.
- [ ] `grep -rn queuedInput v2/src/persistence/state-store.ts` returns zero matches on persisted `Run` shape and insert/update APIs.
- [ ] Subspec 00 workflow dispatch describe is green; subspec 01 removes the ported `run start` dispatch cases and the rest of `describe("run start")` per its collateral ledger.
- [ ] `resolveWriteSiblingCommandSource` no longer spreads `run.queuedInput` or sibling `queuedInput` for fix/ready (`workflow-runner-resume.ts`).
- [ ] Standalone daemon `start` with `params.input` and no workflow `steps` is rejected or unreachable (`handleWriteLoopStart` reachable on main in `daemon-run-lifecycle-handlers.ts` ~897–907).
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/first-workflow-walkthrough.md` — rewrite live-control demo off `run start`.
- `v2/docs/install-and-config.md` — drop `run start` as a user command.
- `v2/docs/operator-runbook.md` — merge direct-write recovery into workflow guidance.
- `v2/docs/write-behavior.md` — drop `run start` surface docs.
- `v2/docs/v1-behaviors.md` — record CLI, direct admission, `queuedInput`, and queued direct-write promotion retirement.

## Primary implementation surface

- `v2/src/commands/run.ts`, `v2/src/commands/write.ts`, `v2/src/commands/run.test.ts`, `v2/src/commands/workflow.test.ts`
- `v2/src/daemon/daemon-run-lifecycle-handlers.ts`, `v2/src/daemon/daemon.ts`
- `v2/src/persistence/state-store.ts`
- `v2/src/execution/workflow-runner-resume.ts` and resume/daemon tests that seed `queuedInput` (subspec 02 fallout; gate-source slice in subspec 03)
