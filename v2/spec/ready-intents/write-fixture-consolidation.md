---
name: write-fixture-consolidation
---

# Write fixture consolidation

Share the agent-runnable write-test fixtures for temporary Jarvis homes, cleanup, and fake external worktrees across `write.test.ts` and `write-loop.test.ts` without changing their scenario coverage.

## Decisions

- Extract a lightweight Jarvis-home fixture with optional state DB path; rules out one broad setup helper that also owns git worktree setup.
- Extract one configurable fake external-worktree factory; rules out keeping separate fakes whose differences are defaults.
- Extract shared temp-root cleanup for tests that allocate local roots; rules out each migrated file maintaining its own `roots[]` cleanup loop.
- Keep `write-loop.test.ts` as a scenario matrix; rules out merging or deleting cases during fixture migration.
- No production code changes; rules out folding production path-resolution helpers into this refactor.

## Prerequisites

- v2 test-writing conventions require agent-runnable tests to avoid real process spawn when subprocesses are incidental.

## Documentation updates

- `v2/docs/test-writing.md` lists shared temporary-root, Jarvis-home, and fake external-worktree fixtures under `v2/src/testing/`.
