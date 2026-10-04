---
name: persistence-library-relocation
---

# Persistence library relocation

Move `state-store*` and `log-stream*` modules with co-located tests into the persistence domain directory; behavior unchanged.

## Decisions

- `git mv` modules and co-located `*.test.ts` / `*.sandbox-unrunnable.test.ts` together — rules out copy-delete moves that drop history.
- Update relative imports only; no logic refactors, type renames, or file splits — rules out bundling cleanup with the move.
- Persistence imports `shared/` only per layout contract — rules out new host or execution imports introduced by path fixes.

## Prerequisites

- `v2-architecture.md` **Source layout** documents the persistence domain directory and import rules.

## Documentation updates

- `v2/docs/state-store.md` — fix `v2/src/<file>` citations only.
