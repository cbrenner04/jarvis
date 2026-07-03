---
name: tui-host-relocation
---

# TUI host relocation

Move all `tui-*` modules with co-located tests into the TUI host domain directory; behavior unchanged.

## Decisions

- `git mv` modules and co-located `*.test.ts` / `*.test.tsx` together — rules out copy-delete moves that drop history.
- Update relative imports only; no Ink/renderer refactors — rules out bundling TUI behavior work with the move.
- TUI host may import execution library, persistence library, `ipc/`, daemon host modules, and `shared/` per layout contract — rules out imports from CLI host.

## Prerequisites

- Execution library modules live under the execution domain directory per `v2-architecture.md` **Source layout**.
- Persistence library modules live under the persistence domain directory per `v2-architecture.md` **Source layout**.
- Daemon host modules live under the daemon host domain directory per `v2-architecture.md` **Source layout**.
- `ipc/` remains at `v2/src/ipc/`.

## Documentation updates

- `v2/docs/write-behavior.md` — fix TUI-module `v2/src/<file>` citations only.
- `v2/docs/v1-behaviors.md` — update `Sources:` paths for TUI-cited modules only.
