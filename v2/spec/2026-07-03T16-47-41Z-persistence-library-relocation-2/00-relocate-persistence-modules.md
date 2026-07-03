# 00 — Relocate persistence modules

Move persistence library modules from flat `v2/src/` root into
`v2/src/persistence/` per **Source layout** in `v2/docs/v2-architecture.md`.
Behavior unchanged.

## Out of scope

- Hoisting persistence↔execution type edges to `shared/` or colocating modules.
- Execution, daemon, TUI, or CLI host relocation.
- Biome import-boundary enforcement.
- `v2/docs/telemetry-capture.md` or `v2/docs/v1-behaviors.md` path updates (no
  persistence path entries today; other doc citations land with their slices).

## Decisions

- `git mv` six persistence basenames with co-located tests into
  `v2/src/persistence/` — rules out copy-delete moves that drop history.
- Relative import path fixes only; no logic refactors, type renames, or file
  splits — rules out bundling cleanup with the move.
- Committed persistence→execution type-only edges (`state-store.ts` →
  `invocation-failure.ts`, `log-stream.ts` → `write-loop.ts`) get path fixes
  only — rules out new host/execution imports and rules out breaking those edges
  in this slice.
- Doc path fixes limited to `v2/docs/state-store.md` `v2/src/<file>` citations
  — rules out cross-doc path churn outside that file.

### Modules (today's flat root → target)

| Basename |
| --- |
| `log-stream.ts` |
| `log-stream.test.ts` |
| `log-stream.sandbox-unrunnable.test.ts` |
| `state-store-types.ts` |
| `state-store.ts` |
| `state-store.test.ts` |

### Importers to re-path (non-exhaustive; grep `log-stream` / `state-store`)

Hosts and libraries still at flat root today import via `./…`; after the move
use `./persistence/…` from `v2/src/` root or `../persistence/…` from `v2/src/ipc/`.
Persistence modules import sibling persistence via `./…`; execution type edges
via `../invocation-failure.ts` and `../write-loop.ts` until execution
relocation.

## Task checklist

- [ ] `git mv` all six modules into `v2/src/persistence/`.
- [ ] Fix relative imports in moved modules (siblings, execution type edges,
  `shared/`).
- [ ] Fix relative imports in every importer under `v2/src/` (including
  `ipc/` tests with embedded spawn paths).
- [ ] Update `v2/docs/state-store.md` source citations to
  `v2/src/persistence/…`.
- [ ] `bun run typecheck` and `bun run test`.

## Acceptance criteria

- [ ] `log-stream.ts`, `log-stream.test.ts`, `log-stream.sandbox-unrunnable.test.ts`, `state-store-types.ts`, `state-store.ts`, and `state-store.test.ts` live under `v2/src/persistence/` and are absent from `v2/src/` root.
- [ ] `state-store.test.ts` stays green.
- [ ] `log-stream.test.ts` stays green.
- [ ] `log-stream.sandbox-unrunnable.test.ts` stays green.
- [ ] `write-loop.test.ts` stays green.
- [ ] `v2/docs/state-store.md` cites `../src/persistence/state-store.ts` (no stale flat-root `../src/state-store.ts` link).

## Documentation updates

- `v2/docs/state-store.md` — fix `v2/src/<file>` citations only.
