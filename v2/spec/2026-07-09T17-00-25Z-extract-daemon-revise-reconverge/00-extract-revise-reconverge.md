# Extract revise/reconverge region into daemon-revise.ts

`v2/src/daemon/daemon.ts` (1256 lines) carries `buildRevisionWriteLoopInput`,
`reviseAwaitingHuman`, and `reconvergeRevisingRun` — a self-contained
revise/reconverge region with no callers outside the file. `reviseAwaitingHuman`
and `reconvergeRevisingRun` are closures inside `createRunControlHandlers`
that close over `store`, `_registry`, `checkWorktreeDirty`, and
`spawnWriteLoop`.

## Decisions

- New file `v2/src/daemon/daemon-revise.ts` holds all three functions.
- Follow the existing `PromoteQueuedRunDeps`/`promoteQueuedRunImpl` pattern (same file, line ~408): closures become exported functions taking an explicit deps object, not free-floating closures — precedent already in `daemon.ts` for extracting a closure-heavy region.
- `daemon.ts` keeps thin wrapper closures inside `createRunControlHandlers` that build the deps object once and call into `daemon-revise.ts`.
- `REVISION_INACTIVE_STATUSES` moves with `reconvergeRevisingRun` (only consumer).
- `LoadedRun` (currently unexported, `daemon.ts:293`) gets an `export` so `daemon-revise.ts` can import it — single source of truth over duplicating the type alias.
- No behavior change; no test file moves or renames.

## Out of scope

- Any behavior change.
- The list-snapshot assembly region (separate intent).

## Task Checklist

- [ ] Create `v2/src/daemon/daemon-revise.ts` with `buildRevisionWriteLoopInput`, a `ReviseReconvergeDeps` type (`store`, `registry`, `checkWorktreeDirty`, `spawnWriteLoop`), `reviseAwaitingHuman(deps, run, prompt)`, `reconvergeRevisingRun(deps, run)`, and `REVISION_INACTIVE_STATUSES`.
- [ ] Export `LoadedRun` from `daemon.ts`.
- [ ] In `daemon.ts`, replace the inline `reviseAwaitingHuman`/`reconvergeRevisingRun` definitions with calls into `daemon-revise.ts`, passing a deps object built from the existing `store`, `_registry`, `checkWorktreeDirty`, `spawnWriteLoop` locals.
- [ ] Remove the now-dead inline `buildRevisionWriteLoopInput` and `REVISION_INACTIVE_STATUSES` from `daemon.ts`.

## Acceptance criteria

- [ ] `daemon-revise.test.ts` stays green (behavior unchanged by the extraction).
- [ ] `daemon-start-list.test.ts` stays green (behavior unchanged by the extraction).
- [ ] `bun run typecheck` passes with no errors introduced by the move.
- [ ] `daemon.ts` no longer defines `buildRevisionWriteLoopInput`, `reviseAwaitingHuman`, `reconvergeRevisingRun`, or `REVISION_INACTIVE_STATUSES`; they live only in `v2/src/daemon/daemon-revise.ts`.

## Documentation updates

- `v2/docs/v2-architecture.md` domain map row for the daemon host (line ~23): add `daemon-revise.ts` to the listed relocated files.
