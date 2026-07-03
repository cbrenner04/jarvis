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

## Blocker

- **Execution library domain directory** — `v2-architecture.md` has no **Source layout** section; `write-loop*`, `write*`, `step-runner*`, and siblings remain at `v2/src/` root. Land `v2-src-layout-contract` then `execution-library-relocation` first.
- **Persistence library domain directory** — same: no **Source layout**; `state-store*` and `log-stream*` remain at `v2/src/` root. Land `v2-src-layout-contract` then `persistence-library-relocation` first.
- **Daemon host domain directory** — same: `daemon*` and `run-operator-error*` remain at `v2/src/` root. Land `daemon-host-relocation` after execution and persistence relocations.
