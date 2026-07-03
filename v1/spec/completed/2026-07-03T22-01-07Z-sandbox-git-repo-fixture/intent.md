---
name: sandbox-git-repo-fixture
---

# Sandbox git repo fixture

Move real-git repository setup used by sandbox-unrunnable external-worktree tests into a clearly named shared testing fixture, keeping real process usage out of agent-runnable tests.

## Decisions

- Keep real `git init` setup behind a sandbox-oriented fixture name; rules out agent-runnable write tests importing a helper that spawns git.
- Preserve external-worktree test assertions while replacing local setup duplication; rules out broad production worktree refactors.
- Keep single-consumer lock-root helper file-local for now; rules out exporting `getLockRoot` before a second consumer exists.
- Reuse shared temp-root cleanup if available; rules out another local cleanup pattern in migrated sandbox tests.

## Prerequisites

- v2 test-writing conventions mark real-process tests with `.sandbox-unrunnable`.

## Documentation updates

- `v2/docs/test-writing.md` lists sandbox-only git repository fixtures under `v2/src/testing/` and warns agent-runnable tests not to import them.
