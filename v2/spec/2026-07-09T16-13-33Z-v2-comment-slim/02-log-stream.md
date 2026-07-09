# 02 - Log-stream event narration

Trim the per-event-type doc-comments in `v2/src/persistence/log-stream.ts` (`IterationStartedEvent`, `BoundaryCommittedEvent`, `LoopFinishedEvent`, `RunExecutionFailedEvent`, `PersistedRecord`, `LogSink`, `LogReader`) — each currently restates "Event emitted when..." plus the shape already visible in the type.

## Decisions

- Zero behavior or signature changes; comments only.
- Drop comments that only restate "Event emitted when X" where X is evident from the type name and its `kind` literal; keep only fields whose semantics aren't evident (e.g., `follow`'s replay-then-block-for-new-appends contract, `append`'s per-run sequencing).
- No watcher-related comment remains in this file (log-stream is poll-based via `follow`/`tail`); no separate handling needed for the watcher-removal prerequisite.

## Task checklist

- [ ] Remove restating "Event emitted when a/an X" comments on the four `*Event` types where the type name already says this.
- [ ] Keep `LogSink.append`'s and `LogReader.follow`'s non-obvious contract facts (sequence assignment, replay-then-block, `AbortSignal` handling).
- [ ] Re-check `PersistedRecord`'s comment against the tiering rule.

## Acceptance criteria

- [ ] `bun run typecheck` passes with no signature changes in `log-stream.ts`.
- [ ] `v2/src/persistence/log-stream.test.ts` stays green (behavior unchanged).
- [ ] None of the four `*Event` type comments restate their own type name.

## Documentation updates

None — comments-only change, no operator-facing or cross-file behavior changed.
