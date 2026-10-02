---
name: retire-run-start
---

# Retire the run start command and write-loop persistence

## Problem

`run start` is the only producer of write-loop-kind runs with durable `queuedInput` (daemon-run-lifecycle-handlers.ts). It is superseded by `run workflow` as the sole user-facing mechanism to start work. The command carries supporting plumbing: `parseWriteCliInput` (commands/write.ts), `reconstructDirectWriteResume` (daemon-run-lifecycle-handlers.ts), and `kind: "write-loop"` run rows with persisted metadata. `run.test.ts` covers daemon auto-start and stale-dispatch behavior via `run start` invocations; this coverage must migrate to `run workflow` argv before the command goes. `resolveWriteSiblingCommandSource` (workflow-runner-resume.ts) reads `queuedInput` from write-run rows as the first resume fix/ready command source; the cut degrades that read to snapshot-only (workflow-kind runs never persisted queuedInput) in the same change.

## Decisions

- Delete the `start` subcommand from the `run` command surface (run.ts).
- Delete `parseWriteCliInput` from the public write.ts export (no internal caller remains).
- Delete `reconstructDirectWriteResume` (daemon-run-lifecycle-handlers.ts); log-based resume discovery becomes the only path for paused write-loop rows.
- Delete `kind: "write-loop"` run rows and `queuedInput` from the Run persisted shape in the store.
- Migrate `run.test.ts` daemon auto-start and stale-dispatch coverage (inferred from existing write-loop tests) to equivalent tests under `run workflow` argv before the cut; no coverage dropped.
- In `resolveWriteSiblingCommandSource` (workflow-runner-resume.ts), remove `queuedInput` read path from the fix/ready command source list; snapshot step reads stay as fallback.
- Rules out deleting queuedInput before stale-dispatch coverage migrates to workflows.

## Prerequisites

- Retire `run pause` (pauseController plumbing removed) (delivered by: retire-run-pause)

## Acceptance criteria

- [ ] `run start` subcommand is gone; the verb does not appear in `run --help` or `jarvis help run`.
- [ ] `parseWriteCliInput` is deleted from `v2/src/commands/write.ts` public export and has no callers outside test support.
- [ ] `reconstructDirectWriteResume` is deleted; `grep -rn reconstructDirectWriteResume v2/src --include="*.ts"` returns zero matches.
- [ ] `kind: "write-loop"` does not appear in daemon, run store, or lifecycle handler code; grep finds zero instances in v2/src/daemon.
- [ ] `queuedInput` field is deleted from Run persisted type (daemon-run-lifecycle-handlers.ts, store.ts,); no new run row carries it.
- [ ] Auto-start coverage from run.test.ts is ported to an equivalent `run workflow` test with daemon auto-start verification; the old test is deleted.
- [ ] `resolveWriteSiblingCommandSource` no longer reads `run.queuedInput` as a fix/ready command source (workflow-runner-resume.ts); snapshot step fallback remains.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/first-workflow-walkthrough.md` — remove `run start` pause/resume demo section or rewrite around workflows.
- `v2/docs/install-and-config.md` — remove references to `run start` as a user command; verify `jarvis help` or `init` is the entry point for setup.
- `v2/docs/operator-runbook.md` — remove `run start` recovery or merge into `run workflow` guidance.
- `v2/docs/write-behavior.md` — remove any documentation of `run start` command surface; document any write-loop behavior that is no longer applicable.
- `v2/docs/v1-behaviors.md` — record `run start` and write-loop persistence retirement.

## Primary implementation surface

- `v2/src/commands/run.ts` (remove start subcommand and dispatch)
- `v2/src/commands/write.ts` (delete or keep parseWriteCliInput as internal-only)
- `v2/src/daemon/daemon-run-lifecycle-handlers.ts` (delete reconstructDirectWriteResume, queuedInput writes)
- `v2/src/execution/write-loop.ts` (remove kind:write-loop row creation)
- `v2/src/execution/workflow-runner-resume.ts` (degrade queuedInput read to snapshot-only)
- `v2/src/daemon/store.ts` (remove queuedInput from Run persisted schema)
- `v2/src/commands/run.test.ts` (migrate auto-start/stale-dispatch coverage to run workflow)
