# 01 - Daemon tail-stream and run-control handlers

Trim the JSDoc blocks on `createTailStreamHandler` and `createRunControlHandlers` in `v2/src/daemon/daemon.ts` — both currently narrate what the function body already shows line-by-line.

## Decisions

- Zero behavior or signature changes; comments only.
- `TailStreamHandlerDeps` and `createTailStreamHandler` each carry overlapping `@invariant`/prose blocks restating the same guard-then-follow sequence visible in the body; keep only the facts not evident from reading the ~20-line implementation (e.g., which failures propagate to IPC as `stream-end`), drop restated control flow.
- Do not touch the `revision-inactive-statuses` rationale comment (~line 135-137) — explicit keep-list, load-bearing constraint.
- `createRunControlHandlers`'s existing inline comments (e.g., `reportReviewDebateProgress`, `close`) are already one-liners; leave as-is unless they restate the adjacent code.

## Task checklist

- [ ] Trim `TailStreamHandlerDeps` and `createTailStreamHandler` JSDoc to non-obvious facts only.
- [ ] Confirm the revision-inactive-statuses comment near line 135 is untouched.
- [ ] Re-check `createRunControlHandlers`'s surrounding comments against the tiering rule.

## Acceptance criteria

- [ ] `bun run typecheck` passes with no signature changes in `daemon.ts`.
- [ ] `v2/src/daemon/daemon-tail-stream.test.ts` stays green (behavior unchanged).
- [ ] `v2/src/daemon/daemon-lifecycle.test.ts` stays green (behavior unchanged).
- [ ] The revision-inactive-statuses rationale comment is present, unmodified.

## Documentation updates

None — comments-only change, no operator-facing or cross-file behavior changed.
