# Make dispatch status replies test-authored

## Problem

`makeIpcClient` derives daemon status replies with production `advanceLoadedRevision`. CLI dispatch tests can therefore agree with a broken revision advance instead of detecting it.

## Decisions

- `makeIpcClient` returns fixed or caller-authored status revision and digest values verbatim; rules out calling `advanceLoadedRevision` or duplicating its rules in the fake.
- Dispatch regressions hard-code their expected daemon status fixtures and independently pin the production revision advance; rules out deriving fixtures from the production result under test.
- Keep the in-memory IPC fake for CLI dispatch coverage; rules out replacing fast CLI tests with daemon-process tests.

## Work

- Remove production revision-advance behavior from `makeIpcClient` and make status replies fixed or explicitly authored.
- Update CLI dispatch call sites with explicit status fixtures where revision or digest semantics matter.
- Make the docs-only-merge CLI regression independently catch removal of matching-digest HEAD-drift advancement while still proving dispatch proceeds without a bounce.
- Add the independent-oracle constraint to `v2/docs/operator-runbook.md` Gate trust.

## Acceptance criteria

- [ ] `makeIpcClient` forms status replies without calling `advanceLoadedRevision` or equivalent production-derived logic.
- [ ] The docs-only-merge regression in `v2/src/commands/run.test.ts` fails when `advanceLoadedRevision` no longer advances matching-digest HEAD drift and passes with the production behavior intact.
- [ ] CLI dispatch tests author the status revision and executable digest they assert, while unrelated users of `makeIpcClient` retain a fixed default reply.
- [ ] Existing CLI dispatch coverage in `v2/src/commands/run.test.ts` and `v2/src/commands/workflow.test.ts` stays green.
- [ ] No test awaits `makeIpcClient().nextFrame()` for a reply that `send()` already delivered. `send()` delivers a `status` reply synchronously; with no waiter parked it does `queue.unshift(frame)`, and `nextFrame()` parks a new waiter without draining the queue whenever `drainFrames` is false — so `send(...)` then `await nextFrame()` hangs forever and blows the per-file test budget. Either park the waiter before sending, or make `nextFrame()` drain a queued frame before parking. **A prior attempt (PR #1914) failed CI exactly here**: `v2/src/commands/run.test.ts` timed out at 180s on two consecutive runs while the local gate passed.
- [ ] `bun run typecheck` and `bun run test:v2` pass, and `v2/src/commands/run.test.ts` completes well inside the 180-second per-file budget rather than merely not asserting.
- [ ] `v2/docs/operator-runbook.md` Gate trust states that mutation verification depends on test expectations independent of the mutated production behavior and that self-referential doubles invalidate that evidence.

## Documentation updates

- `v2/docs/operator-runbook.md` — independent-oracle constraint under Gate trust.
