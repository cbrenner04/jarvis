# 00 — Pin source layout in durable docs

Document the role-based `v2/src/` domain map, import-direction rules, and
entrypoint policy in durable docs before relocation intents move modules. No code
moves in this slice.

## Out of scope

- `git mv` module relocation (follow-on intents).
- Biome import-boundary enforcement.
- Barrel `index.ts` re-export layers.
- `v2/docs/v1-behaviors.md` path updates (land with each relocation subspec).

## Decisions

- **Source layout** is the single durable home in `v2-architecture.md` — rules out duplicating the domain map or import matrix in per-domain docs.
- Domain directories use role basenames (`execution/`, `persistence/`, `daemon/`, `tui/`), not filename-prefix groupings at `v2/src/` root — rules out `tui-*` / `daemon-*` sibling directories beside domain folders.
- `ipc/` and `testing/` stay at `v2/src/ipc/` and `v2/src/testing/` — rules out a parallel `v2/test/` tree or re-homing those subtrees.
- Entrypoints stay at `v2/src/cli.ts` and `v2/src/daemon-entrypoint.ts` — rules out relocating them without updating `bin/jarvis` and `daemon-lifecycle` default spawn in the same change set.
- CLI host with root entrypoint has no `cli/` subdirectory while only `cli.ts` / `cli.test.ts` constitute the domain — rules out an empty `cli/` folder or moving the shim target off root.
- No barrel `index.ts` re-export layers — rules out host facades that hide dependency graphs.
- Import matrix: hosts → libraries + `ipc/` + `shared/`; execution → persistence + `shared/`; persistence → `shared/` only; `ipc/` → `shared/` only; `testing/` → anything — rules out library → host imports.
- TUI host may import daemon host modules (daemon client wiring) — rules out treating all hosts as mutually isolated.
- Every current `v2/src/` root file maps to exactly one domain in **Source layout** — rules out stragglers or dual ownership.
- Deferred to first consumer: Biome rules encoding the import matrix — pin when a follow-up seed proves automation worthwhile.

### Domain directories and current root-file map

| Domain | Directory | Root modules (today) |
| --- | --- | --- |
| Execution library | `v2/src/execution/` | `write-loop*`, `write*`, `step-runner*`, `write-prompt*`, `external-worktree*`, `invocation-failure.ts` |
| Persistence library | `v2/src/persistence/` | `state-store*`, `log-stream*` |
| Daemon host | `v2/src/daemon/` | `daemon*` except `daemon-entrypoint.ts`, `run-operator-error*` |
| TUI host | `v2/src/tui/` | `tui-*` |
| CLI host | `v2/src/` root (entrypoint) | `cli*` |
| IPC transport | `v2/src/ipc/` | (already subtree) |
| Test support | `v2/src/testing/` | `preload.sandbox-unrunnable.test.ts` plus existing `testing/` modules |

After relocation, allowed `v2/src/` root entries: `cli.ts`, `cli.test.ts`,
`daemon-entrypoint.ts`, and the `ipc/` and `testing/` subtrees.

## Task checklist

- [ ] Add `## Source layout` to `v2/docs/v2-architecture.md`: domain→directory table, import-direction matrix, entrypoint policy, co-located-test convention, no-barrel rule, and the exhaustive current root-file map above.
- [ ] Update `v2/docs/v2-vision.md` repo-layout note: co-located `*.test.ts` beside domain modules under `v2/src/<domain>/`, not flat `v2/src/*.test.ts`.
- [ ] Update `v2/docs/v2-build-order.md` Phase 0 scaffold wording to reference domain directories and co-located tests instead of a flat root.

## Acceptance criteria

- [ ] `v2/docs/v2-architecture.md` contains `## Source layout` with all five host/library domains, `ipc/`, and `testing/`; import rules match the matrix above; entrypoints pinned at `v2/src/cli.ts` and `v2/src/daemon-entrypoint.ts`.
- [ ] **Source layout** lists every current `v2/src/*.ts` and `v2/src/*.tsx` root file (excluding `ipc/` and `testing/` subtree contents) under exactly one domain row.
- [ ] `v2/docs/v2-vision.md` describes co-located-by-domain tests; the flat `v2/src/*.test.ts` wording is gone.
- [ ] `v2/docs/v2-build-order.md` Phase 0 no longer describes a flat `v2/src/*.test.ts` scaffold as the target shape.

## Documentation updates

- `v2/docs/v2-architecture.md` — new **Source layout** section (canonical home).
- `v2/docs/v2-vision.md` — repo-layout test co-location note.
- `v2/docs/v2-build-order.md` — Phase 0 scaffold wording.
