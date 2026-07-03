# 00 — Relocate persistence modules

Move persistence library modules from flat `v2/src/` root into
`v2/src/persistence/` per **Source layout** in `v2/docs/v2-architecture.md`.
Behavior unchanged.

## Out of scope

- Hoisting persistence↔execution type edges to `shared/` or colocating modules.
- Execution, daemon, TUI, or CLI host relocation.
- Biome import-boundary enforcement.
- `v2/docs/v1-behaviors.md` path updates (behavior-preserving; no catalog change).

## Decisions

- `git mv` six persistence basenames with co-located tests into
  `v2/src/persistence/` — rules out copy-delete moves that drop history.
- Relative import path fixes only; no logic refactors, type renames, or file
  splits — rules out bundling cleanup with the move.
- Committed persistence→execution type-only edges (`state-store.ts` →
  `invocation-failure.ts`, `log-stream.ts` → `write-loop.ts`) get path fixes
  only — rules out new host/execution imports and rules out breaking those edges
  in this slice.
- Persistence imports `shared/` plus those committed execution type edges only —
  rules out treating intent “shared/ only” as forbidding the committed
  exceptions.
- Doc path fixes in `v2/docs/state-store.md`, `v2/docs/telemetry-capture.md`,
  and persistence row in `v2/docs/v2-architecture.md` **Source layout** —
  rules out leaving rot in cited cross-doc links and rules out flat-root
  inventory contradicting the relocated tree.
- Co-update `test/test-slices.test.ts` hardcoded
  `v2/src/log-stream.sandbox-unrunnable.test.ts` path on move — rules out
  harness slice enumeration drift (same pattern as `preload.sandbox-unrunnable`).

### Modules (today's flat root → target)

| Basename |
| --- |
| `log-stream.ts` |
| `log-stream.test.ts` |
| `log-stream.sandbox-unrunnable.test.ts` |
| `state-store-types.ts` |
| `state-store.ts` |
| `state-store.test.ts` |

### Importers to re-path (non-exhaustive; grep `log-stream`, `state-store`

`state-store-types`, and `persistence/` path patterns)

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
- [ ] Update `test/test-slices.test.ts` hardcoded
  `v2/src/log-stream.sandbox-unrunnable.test.ts` path.
- [ ] Update `v2/docs/state-store.md` source citations to
  `v2/src/persistence/…`.
- [ ] Update `v2/docs/telemetry-capture.md` `../src/log-stream.ts` citations
  to `../src/persistence/log-stream.ts`.
- [ ] Reconcile persistence domain **Root modules (today)** row (or equivalent
  post-move note) in `v2/docs/v2-architecture.md` **Source layout**.
- [ ] `bun run typecheck` and `bun run test`.

## Acceptance criteria

- [ ] `log-stream.ts`, `log-stream.test.ts`, `log-stream.sandbox-unrunnable.test.ts`, `state-store-types.ts`, `state-store.ts`, and `state-store.test.ts` live under `v2/src/persistence/` and are absent from `v2/src/` root.
- [ ] `bun run typecheck` passes.
- [ ] `state-store.test.ts` stays green.
- [ ] `log-stream.test.ts` stays green.
- [ ] `log-stream.sandbox-unrunnable.test.ts` stays green.
- [ ] `ipc.sandbox-unrunnable.test.ts` stays green (embedded spawn path to
  `log-stream.ts`, not only static imports).
- [ ] `write-loop.test.ts` stays green.
- [ ] `test/test-slices.test.ts` stays green (hardcoded
  `v2/src/persistence/log-stream.sandbox-unrunnable.test.ts` path).
- [ ] `v2/docs/state-store.md` cites `../src/persistence/state-store.ts` (no stale flat-root `../src/state-store.ts` link).
- [ ] `v2/docs/telemetry-capture.md` cites `../src/persistence/log-stream.ts` (no stale flat-root `../src/log-stream.ts` links).
- [ ] `v2/docs/v2-architecture.md` **Source layout** persistence row matches the relocated tree (no flat-root module inventory contradicting `v2/src/persistence/`).

## Documentation updates

- `v2/docs/state-store.md` — fix `v2/src/<file>` citations only.
- `v2/docs/telemetry-capture.md` — fix `../src/log-stream.ts` citations.
- `v2/docs/v2-architecture.md` — reconcile persistence domain **Root modules (today)** row (or equivalent post-move note).
