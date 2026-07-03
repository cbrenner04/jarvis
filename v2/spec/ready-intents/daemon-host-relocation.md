---
name: daemon-host-relocation
---

# Daemon host relocation

Move `daemon*` (except entrypoint policy), `run-operator-error*`, and co-located tests into the daemon host domain directory; behavior unchanged.

## Decisions

- Apply entrypoint policy from **Source layout** for `daemon-entrypoint.ts` in the same subspec — rules out leaving `daemon-lifecycle` default spawn on a stale path.
- `git mv` modules and co-located tests together — rules out copy-delete moves that drop history.
- Update relative imports only; no logic refactors or handler rewrites — rules out bundling daemon behavior work with the move.
- Daemon host may import execution library, persistence library, `ipc/`, and `shared/` per layout contract — rules out imports from CLI or TUI hosts.

## Prerequisites

- Execution library modules live under the execution domain directory per `v2-architecture.md` **Source layout**.
- Persistence library modules live under the persistence domain directory per `v2-architecture.md` **Source layout**.

## Documentation updates

- `v2/docs/daemon-host.md` — fix `v2/src/<file>` citations only.
- `v2/docs/test-writing.md` — fix daemon-module `v2/src/<file>` citations only.
- `v2/docs/v1-behaviors.md` — update `Sources:` paths for daemon-cited modules only.
