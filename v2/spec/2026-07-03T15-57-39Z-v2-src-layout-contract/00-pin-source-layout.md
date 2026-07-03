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

- **Source layout** is the single durable home in `v2-architecture.md` — rules out duplicating the domain map or import matrix in per-domain docs; subsumes the `coding-standards.md` module-responsibilities pointer.
- Domain directories use role basenames (`execution/`, `persistence/`, `daemon/`, `tui/`), not filename-prefix groupings at `v2/src/` root — rules out `tui-*` / `daemon-*` sibling directories beside domain folders.
- `ipc/` and `testing/` stay at `v2/src/ipc/` and `v2/src/testing/` — rules out a parallel `v2/test/` mirror of `v2/src/`; grandfathered `v2/test/fixtures/` (Biome demos per `v2-vision.md`) stays.
- Entrypoints stay at `v2/src/cli.ts` and `v2/src/daemon-entrypoint.ts` — rules out relocating them without updating `bin/jarvis` (`../v2/src/cli.ts`) and `daemon-lifecycle.ts` default spawn (`resolve(import.meta.dir, "daemon-entrypoint.ts")`) in the same change set.
- CLI host with root entrypoint has no `cli/` subdirectory while only `cli.ts` / `cli.test.ts` constitute the domain — rules out an empty `cli/` folder or moving the shim target off root.
- No barrel `index.ts` re-export layers — rules out host facades that hide dependency graphs.
- Import matrix (target direction; Biome enforcement may lag until relocation + follow-on subspec): hosts → libraries + `ipc/` + `shared/` + sibling hosts (composition; e.g. CLI → daemon/TUI today); execution → persistence + `shared/`; persistence → `shared/` only; `ipc/` → `shared/` only; `testing/` → anything; production code ↛ `testing/` — rules out library → host imports and production imports of test support.
- Persistence → execution exception (today only): `state-store.ts` type-imports `InvocationFailureDetail` from `invocation-failure.ts` — break on persistence or execution relocation (hoist type to `shared/` or colocate) — rules out silently forbidding a committed edge or allowing value imports across libraries.
- Every current `v2/src/` root file maps to exactly one domain in **Source layout** — rules out stragglers or dual ownership.
- Deferred to first consumer: Biome rules encoding the import matrix — pin when a follow-on seed proves automation worthwhile.

### Domain directories and current root-file map

Explicit inventory (today's flat root; relocation moves each file under its domain directory).

| Domain | Directory | Root modules (today) |
| --- | --- | --- |
| Execution library | `v2/src/execution/` | `external-worktree.ts`, `external-worktree.sandbox-unrunnable.test.ts`, `invocation-failure.ts`, `step-runner.ts`, `step-runner.test.ts`, `write-loop-input.ts`, `write-loop-input.test.ts`, `write-loop.ts`, `write-loop.test.ts`, `write-prompt.ts`, `write-prompt.test.ts`, `write.ts`, `write.test.ts` |
| Persistence library | `v2/src/persistence/` | `log-stream.ts`, `log-stream.test.ts`, `log-stream.sandbox-unrunnable.test.ts`, `state-store-types.ts`, `state-store.ts`, `state-store.test.ts` |
| Daemon host | `v2/src/daemon/` | `daemon.ts`, `daemon.sandbox-unrunnable.test.ts`, `daemon-wire.ts`, `daemon-wire.test.ts`, `daemon-lifecycle.ts`, `daemon-lifecycle.test.ts`, `daemon-run-failure-capture.test.ts`, `daemon-start-list.test.ts`, `daemon-tail-stream.test.ts`, `daemon-wait-run-completion.test.ts`, `run-operator-error.ts`, `run-operator-error.test.ts`, `daemon-entrypoint.ts` (root entrypoint only) |
| TUI host | `v2/src/tui/` | `tui-daemon-client.ts`, `tui-daemon-client.test.ts`, `tui-daemon-errors.ts`, `tui-daemon-rpc-transport.ts`, `tui-entry.tsx`, `tui-entry.test.tsx`, `tui-field-collector.tsx`, `tui-ink-feedback.tsx`, `tui-ink-log-follow.tsx`, `tui-ink-monitor.tsx`, `tui-ink-runtime.ts`, `tui-log-follow-entry.tsx`, `tui-log-follow-entry.test.tsx`, `tui-log-follow-lines.ts`, `tui-log-follow-types.ts`, `tui-log-tail-client.ts`, `tui-log-tail-client.test.ts`, `tui-monitor-lines.ts`, `tui-monitor-types.ts` |
| CLI host | `v2/src/` root (entrypoint) | `cli.ts`, `cli.test.ts` |
| IPC transport | `v2/src/ipc/` | (already subtree) |
| Test support | `v2/src/testing/` | `preload.sandbox-unrunnable.test.ts` (root today; harness `test/test-slices.test.ts` hardcodes path — co-update on move) plus existing `testing/` modules |

After relocation, allowed `v2/src/` root entries: `cli.ts`, `cli.test.ts`,
`daemon-entrypoint.ts`, and the `ipc/` and `testing/` subtrees.

## Task checklist

- [ ] Diff `v2/src/*.{ts,tsx}` at repo root against the table above; reconcile any drift before doc work.
- [ ] Add `## Source layout` to `v2/docs/v2-architecture.md`: domain→directory table, import-direction matrix (including production ↛ `testing/` and persistence type-only exception), entrypoint policy (`bin/jarvis`, `daemon-lifecycle` spawn), co-located-test convention, no-barrel rule, target-vs-enforced note, and the explicit per-file inventory above; reconcile or forward-reference stale flat-root path citations in the same file (e.g. `v2/src/daemon-lifecycle.ts` → `daemon/`).
- [ ] Update `v2/docs/v2-vision.md` repo-layout note: co-located `*.test.ts` beside domain modules under `v2/src/<domain>/`, not flat `v2/src/*.test.ts`; keep `v2/test/fixtures/` grandfathering.
- [ ] Update `v2/docs/v2-build-order.md` Phase 0: preserve shipped flat-root scaffold history; forward-reference **Source layout** as the target shape (domain directories + co-located tests).

## Acceptance criteria

- [ ] `v2/docs/v2-architecture.md` contains `## Source layout` with all five host/library domains, `ipc/`, and `testing/`; import rules match the matrix above; entrypoints pinned at `v2/src/cli.ts` and `v2/src/daemon-entrypoint.ts` with `bin/jarvis` and `daemon-lifecycle.ts` spawn coupling named; co-located-by-domain test convention and no-barrel rule stated; no same-file flat-root path contradicts the domain map without a forward reference.
- [ ] **Source layout** lists every current `v2/src/*.ts` and `v2/src/*.tsx` root file (excluding `ipc/` and `testing/` subtree contents) by explicit basename under exactly one domain row — no glob patterns.
- [ ] `v2/docs/v2-vision.md` describes co-located-by-domain tests; the flat `v2/src/*.test.ts` wording is gone; `v2/test/fixtures/` grandfathering retained.
- [ ] `v2/docs/v2-build-order.md` Phase 0 records the flat root that shipped and points at **Source layout** as the target shape — does not rewrite Phase 0 as if domain directories always existed.

## Documentation updates

- `v2/docs/v2-architecture.md` — new **Source layout** section (canonical home).
- `v2/docs/v2-vision.md` — repo-layout test co-location note.
- `v2/docs/v2-build-order.md` — Phase 0 historiography + target forward reference.
