# Drop `queuedInput` and ad-hoc `write-loop` rows

## Primary implementation surface

- `v2/src/daemon/daemon-run-lifecycle-handlers.ts`
- `v2/src/daemon/daemon.ts` (`promoteQueuedRunImpl` / `resolveWriteLoopBindings(run.queuedInput)`)
- `v2/src/persistence/state-store.ts`
- `v2/src/execution/workflow-runner-resume.ts` (non–`resolveWriteSiblingCommandSource` `queuedInput` reads: intent-landing reprompt, stepRules, external plan persistence)
- `v2/src/execution/workflow-runner-resume-intent-landing-contract-reprompt.test.ts`
- `v2/src/daemon/operator-incidents.ts`, `v2/src/daemon/workflow-invocation-live.test.ts`
- `v2/src/daemon/daemon-run-lifecycle-handlers.test.ts`, `v2/src/daemon/daemon-resume.test.ts`, `v2/src/daemon/daemon-queue-promotion.test.ts`, `v2/src/daemon/daemon-reconciliation.test.ts`, `v2/src/daemon/run-time-budget.test.ts`, and other daemon tests seeding direct-write `queuedInput`

## Problem

Direct daemon `start` with `params.input` persists `queuedInput` and registers `ActiveRun` `kind: "write-loop"` (`startHandler`, `reconstructDirectWriteResume`). Workflow admission uses snapshot + log replay via `reconstructWriteResume`; the column and ad-hoc kind go with CLI retirement.

## Decisions

- Remove standalone write-loop admission from daemon `start` and stop persisting `queuedInput` on insert/update — rules out a headless direct-write RPC after CLI removal.
- Delete `reconstructDirectWriteResume`; paused workflow write steps resume only through `reconstructWriteResume` — rules out a second direct-write resume constructor.
- Remove `queuedInput` from persisted `Run` in `state-store.ts` (type, SQLite projection, load/save) — rules out soft-nulling while keeping columns; deferred to first consumer: on-disk migration for historical `queued_input` JSON — pin when an operator reports load failure.
- Remove `ActiveRun` / handler `kind: "write-loop"` and retarget kill/live/workflow-invocation guards to workflow/finalization rows — rules out treating ad-hoc write loops as live workflow siblings (`workflow-invocation-live.test.ts`).
- Retire in-memory queued direct-write promotion paths that read `run.queuedInput` in `promoteQueuedRunImpl` / `daemon-queue-promotion.test.ts` fixtures — rules out promotion of rows this spec no longer admits.
- Rewrite or delete daemon/resume tests that seed direct-write `queuedInput` (`daemon-run-lifecycle-handlers.test.ts` `resume admits a paused direct write run with durable queuedInput`, `daemon-resume.test.ts`, reconciliation fixtures, intent-landing reprompt seeds) to workflow-snapshot shapes — rules out tests requiring removed persistence.
- Keep subspec 03 scoped to `resolveWriteSiblingCommandSource` gate spreads; all other `queuedInput` fallout lands here — rules out splitting admission and column removal across PRs without flags.

## Task checklist

- Collapse lifecycle resume input resolution to snapshot/log paths only.
- Add or extend a daemon test that `start` with `params.input` and no workflow `steps` is rejected (today `handleWriteLoopStart` at ~897–907 admits); fails on main, passes after cut.
- Update operator-incident wording that references plain `run start` rows.
- Fix compile errors across daemon, persistence, and resume tests listed above.

## Acceptance criteria

- [x] `grep -rn reconstructDirectWriteResume v2/src --include='*.ts'` returns zero matches; fails on main while `daemon-run-lifecycle-handlers.ts` still defines it.
- [x] `grep -rn 'kind: \"write-loop\"' v2/src/daemon --include='*.ts'` returns zero matches; reachable on main at `daemon-run-lifecycle-handlers.ts`, `daemon.ts`, `workflow-invocation-live.test.ts`.
- [x] `grep -rn queuedInput v2/src/persistence/state-store.ts` returns zero matches on persisted `Run` shape and insert/update APIs; fails on main while `queuedInput` remains on `Run`.
- [x] Daemon test asserting direct-write `start` (`params.input` without workflow `steps`) is rejected or unreachable fails on main and passes after the cut (same admission site as `handleWriteLoopStart`).
- [x] `daemon-run-lifecycle-handlers.test.ts` no longer contains `resume admits a paused direct write run with durable queuedInput`; replacement workflow-log resume coverage stays green where behavior is preserved.
- [x] `grep -rn queuedInput v2/src/daemon --include='*.ts'` returns zero matches after fallout rewrites; fails on main at lifecycle handlers, `daemon.ts`, and `daemon-queue-promotion.test.ts` direct-write fixtures.
- [x] Subspec 02 resume fallout in `workflow-runner-resume.ts` (intent-landing reprompt, stepRules, external plan persistence) and `workflow-runner-resume-intent-landing-contract-reprompt.test.ts` no longer depend on persisted run-row `queuedInput`; gate spreads inside `resolveWriteSiblingCommandSource` remain for subspec 03.
- [x] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- Defer to subspec 04; prefer a single `v1-behaviors.md` edit there.
