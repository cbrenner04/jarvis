---
name: cli-host-relocation
---

# CLI host relocation

Relocate `cli*` per entrypoint policy, update `bin/jarvis` when `cli.ts` moves, assign any remaining flat-root modules to their domain, and leave `v2/src/` with only contract-allowed root entrypoints plus `ipc/` and `testing/`.

## Decisions

- Apply entrypoint policy from **Source layout** for `cli.ts` and `bin/jarvis` in the same subspec — rules out a working `jarvis` shim pointing at a removed path.
- `git mv` `cli.test.ts` with `cli.ts` when the host moves — rules out orphaned co-located tests at the old root.
- Assign every remaining `v2/src/` root file (e.g. `preload.sandbox-unrunnable.test.ts`) to exactly one domain per **Source layout** — rules out leaving stragglers at flat root.
- Update relative imports only; no CLI behavior changes — rules out bundling command work with the move.
- CLI host may import lower layers per layout contract — rules out library imports from CLI.

## Prerequisites

- Execution library modules live under the execution domain directory per `v2-architecture.md` **Source layout**.
- Persistence library modules live under the persistence domain directory per `v2-architecture.md` **Source layout**.
- Daemon host modules live under the daemon host domain directory per `v2-architecture.md` **Source layout**.
- TUI host modules live under the TUI host domain directory per `v2-architecture.md` **Source layout**.

## Documentation updates

- `v2/docs/write-behavior.md` — fix CLI-module `v2/src/<file>` citations only.
- `v2/docs/v1-behaviors.md` — update remaining `Sources:` paths that cite `v2/src/cli.ts` or other moved CLI modules.

## Blocker

- `v2/docs/v2-architecture.md` has no **Source layout** section — domain directories and entrypoint policy are not pinned in durable docs (`v2-src-layout-contract` not merged).
- Execution library modules (`write-loop*`, `write*`, `step-runner*`, `write-prompt*`, `external-worktree*`, `invocation-failure`) still live at flat `v2/src/` root — `execution-library-relocation` not landed.
- Persistence library modules (`state-store*`, `log-stream*`) still live at flat `v2/src/` root — `persistence-library-relocation` not landed.
- Daemon host modules (`daemon*`, `run-operator-error*`) still live at flat `v2/src/` root — `daemon-host-relocation` not landed.
- TUI host modules (`tui-*`) still live at flat `v2/src/` root — `tui-host-relocation` not landed.
