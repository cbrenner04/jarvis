# 00 — Relocate execution modules

Move execution library modules from flat `v2/src/` root into
`v2/src/execution/` per **Source layout** in `v2/docs/v2-architecture.md`.
Behavior unchanged.

## Out of scope

- Breaking the `state-store.ts` ↔ `invocation-failure.ts` and `log-stream.ts`
  ↔ `write-loop.ts` committed type-only exceptions (hoisting shared types to
  `shared/` or colocating modules) — path fixes only.
- Daemon, TUI, or CLI host relocation.
- Biome import-boundary enforcement.
- `v2/docs/v1-behaviors.md` path updates (behavior-preserving; no catalog
  change).

## Decisions

- `git mv` twelve execution basenames with co-located tests into
  `v2/src/execution/` — rules out copy-delete moves that drop history.
- Relative import path fixes only; no logic refactors, type renames, or file
  splits — rules out bundling cleanup with the move.
- Committed execution↔persistence type-only edges (`invocation-failure.ts` ←
  `state-store.ts`, `write-loop.ts` ← `log-stream.ts`) get path fixes only —
  rules out breaking those edges in this slice.
- Execution imports persistence (`./persistence/…` becomes `../persistence/…`)
  plus `shared/` only — rules out new host imports introduced by path fixes.
- Co-update `test/test-slices.test.ts` hardcoded
  `v2/src/external-worktree.sandbox-unrunnable.test.ts` path on move — same
  pattern as prior `preload.sandbox-unrunnable` and `log-stream.sandbox-unrunnable`
  relocations.

### Modules (today's flat root → target)

| Basename |
| --- |
| `external-worktree.ts` |
| `external-worktree.sandbox-unrunnable.test.ts` |
| `invocation-failure.ts` |
| `step-runner.ts` |
| `step-runner.test.ts` |
| `write-loop-input.ts` |
| `write-loop-input.test.ts` |
| `write-loop.ts` |
| `write-loop.test.ts` |
| `write-prompt.ts` |
| `write-prompt.test.ts` |
| `write.ts` |
| `write.test.ts` |

### Importers to re-path (non-exhaustive; grep the basenames above)

Hosts still at flat root today import via `./…`; after the move use
`./execution/…` from `v2/src/` root. `v2/src/persistence/state-store.ts` and
`v2/src/persistence/log-stream.ts` re-path their committed execution type
edges from `../invocation-failure.ts` / `../write-loop.ts` to
`../execution/invocation-failure.ts` / `../execution/write-loop.ts`. Modules
within execution import sibling persistence via `../persistence/…` and
`shared/` via `../../shared/…`.

## Task checklist

- [ ] `git mv` all thirteen files into `v2/src/execution/`.
- [ ] Fix relative imports in moved modules (siblings, persistence, `shared/`).
- [ ] Fix relative imports in every importer under `v2/src/` (daemon, cli,
  tui-*, run-operator-error, persistence's committed type edges).
- [ ] Update `test/test-slices.test.ts` hardcoded
  `v2/src/external-worktree.sandbox-unrunnable.test.ts` path.
- [ ] Update `v2/docs/shared-step-runner.md` `v2/src/step-runner.ts` citation.
- [ ] Update `v2/docs/write-behavior.md` `../src/external-worktree.ts` and
  `v2/src/write-loop.test.ts` citations.
- [ ] Reconcile execution domain **Root modules (today)** row (or equivalent
  post-move note) in `v2/docs/v2-architecture.md` **Source layout**.
- [ ] `bun run typecheck` and `bun run test`.

## Acceptance criteria

- [ ] `external-worktree.ts`, `external-worktree.sandbox-unrunnable.test.ts`, `invocation-failure.ts`, `step-runner.ts`, `step-runner.test.ts`, `write-loop-input.ts`, `write-loop-input.test.ts`, `write-loop.ts`, `write-loop.test.ts`, `write-prompt.ts`, `write-prompt.test.ts`, `write.ts`, and `write.test.ts` live under `v2/src/execution/` and are absent from `v2/src/` root.
- [ ] `bun run typecheck` passes.
- [ ] `write-loop.test.ts` stays green.
- [ ] `write.test.ts` stays green.
- [ ] `step-runner.test.ts` stays green.
- [ ] `write-loop-input.test.ts` stays green.
- [ ] `write-prompt.test.ts` stays green.
- [ ] `external-worktree.sandbox-unrunnable.test.ts` stays green.
- [ ] `state-store.test.ts` stays green (persistence's committed type edge to `invocation-failure.ts` re-paths).
- [ ] `log-stream.test.ts` stays green (persistence's committed type edge to `write-loop.ts` re-paths).
- [ ] `cli.test.ts` stays green.
- [ ] `daemon.sandbox-unrunnable.test.ts` stays green.
- [ ] `test/test-slices.test.ts` stays green (hardcoded `v2/src/execution/external-worktree.sandbox-unrunnable.test.ts` path).
- [ ] `v2/docs/shared-step-runner.md` cites `v2/src/execution/step-runner.ts` (no stale flat-root link).
- [ ] `v2/docs/write-behavior.md` cites `../src/execution/external-worktree.ts` and `v2/src/execution/write-loop.test.ts` (no stale flat-root links).
- [ ] `v2/docs/v2-architecture.md` **Source layout** execution row matches the relocated tree (no flat-root module inventory contradicting `v2/src/execution/`).

## Documentation updates

- `v2/docs/shared-step-runner.md` — fix `v2/src/<file>` citations only.
- `v2/docs/write-behavior.md` — fix execution-module `v2/src/<file>` citations only.
- `v2/docs/v2-architecture.md` — reconcile execution domain **Root modules (today)** row (or equivalent post-move note).
