---
name: test-authored-dispatch-status-replies
---

# Make dispatch status replies test-authored

## Problem

- `makeIpcClient` computes daemon status replies with production `advanceLoadedRevision`, so CLI dispatch assertions can agree with broken production behavior.

## Outcome

- CLI dispatch tests supply the daemon revision and executable digest they expect the fake to return.
- Reverting `advanceLoadedRevision`'s matching-digest HEAD-drift advance makes the CLI docs-only-merge dispatch regression fail.

## Decisions

- Fake status replies are fixed or test-authored; rules out deriving expected replies through `advanceLoadedRevision` or equivalent production behavior.
- Keep the fake for fast CLI tests; rules out replacing the CLI suite with daemon process tests.

## Acceptance criteria

- [ ] `makeIpcClient` no longer calls production revision-advance behavior to form status replies.
- [ ] The CLI docs-only-merge dispatch regression fails without `advanceLoadedRevision`'s matching-digest HEAD-drift advance and passes with it.
- [ ] Existing CLI dispatch tests remain green with explicit status fixtures.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` Gate trust — mutation verification depends on an independent oracle; self-referential doubles invalidate it.

## Prerequisites
