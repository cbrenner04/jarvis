---
name: execution-library-relocation
---

# Execution library relocation

Move `write-loop*`, `write*`, `step-runner*`, `write-prompt*`, `external-worktree*`, and `invocation-failure` with co-located tests into the execution domain directory; behavior unchanged.

## Decisions

- `git mv` modules and co-located tests together — rules out copy-delete moves that drop history.
- Update relative imports only; no logic refactors, type renames, or file splits — rules out bundling cleanup with the move.
- Execution may import persistence library and `shared/` per layout contract — rules out imports from host domains.

## Prerequisites

- Persistence library modules live under the persistence domain directory per `v2-architecture.md` **Source layout**.

## Documentation updates

- `v2/docs/shared-step-runner.md` — fix `v2/src/<file>` citations only.
- `v2/docs/write-behavior.md` — fix execution-module `v2/src/<file>` citations only.

## Blocker

- **Persistence library not relocated.** `state-store*` and `log-stream*` still live at `v2/src/` root; no `v2/src/persistence/` (or other persistence domain directory) exists in committed code.
- **`v2-architecture.md` lacks Source layout.** No **Source layout** section documents the persistence domain directory or import rules; only uncommitted ready-intents (`v2-src-layout-contract`, `persistence-library-relocation`) describe the target shape.
