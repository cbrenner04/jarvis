# Retiring sole-owner self-heal predicate

`startDaemonRuntime` skips every self-handoff sampling tick while `isRetiring()` (`v2/src/daemon/daemon.ts`), so a generation that still owns the public listener but never cleared `retiring` never reaches digest sampling or backoff retry. The fix needs a testable gate for when that stranded shape may reopen admission without a process restart.

## Decisions

- Export one pure predicate beside the other stable-digest guards in `v2/src/daemon/stable-digest-trigger.ts` — rules out embedding the condition only in the `setInterval` callback (not unit-testable without a real timer) and rules out a daemon-only helper that duplicates the stable-digest module's predicate home.
- Predicate is true only when all hold: `retiring`, `publicBound`, no pending handoff, public liveness probe reports no answering successor, and rollback is not blocked by a non-handoff-origin `supersede` (`blocksRollbackReopen === false`) — rules out self-heal while a handoff transaction is open, while a committed/live successor still answers the public address, while the public listener is released for handoff, and while a genuine external `supersede` must keep the generation retiring.
- Predicate inputs are plain booleans (and the rollback-block flag) passed from wiring — rules out hiding IPC or probe calls inside the predicate.

## Task checklist

- [ ] Add the exported predicate and document the non-obvious rollback-block conjunct in a one-line doc-comment only if name + parameters are insufficient.
- [ ] Extend `stable-digest-trigger.test.ts` with truth and falsity cases for each conjunct and one fully true case.

## Acceptance criteria

- [ ] `stable-digest-trigger.test.ts` exercises the exported self-heal predicate in both truth directions (at least one matching case and one case per blocking conjunct).
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` passes.

## Documentation updates

- None: no operator-visible behavior until [01-stable-digest-sampling-self-heal-wiring.md](01-stable-digest-sampling-self-heal-wiring.md).
