---
name: ready-and-fix-scripts
---

# `ready` is strict CI-parity verification; `fix` is the separate autofix step

## Problem

`bun run ready` runs `check:fix:unsafe` inside the gate, mutating the tree before
strict `check`. Local green can mask CI red on the committed tree.

## Direction

- Add `bun run fix` → `check:fix:unsafe` as the operator/agent autofix entrypoint.
- `ready` full tier becomes pure verification on the committed tree: frozen
  `bun install` (when digest says so), strict `bun run check` (no `:fix`),
  `typecheck`, `test` (serial retry unchanged), `lint:md`. No autofix step.
- Invariant: green `ready` ⇒ green CI on install/lint/format/typecheck/test.
- `fast` tier unchanged (`typecheck` + `test` only).

## Decisions

- `fix` wraps `check:fix:unsafe`, not `check:fix` — rules out safe-only autofix that leaves residual lint issues the gate must catch.
- Autofix lives only in `fix`; `ready` never invokes `:fix` — rules out keeping hidden mutation inside the gate.
- Deferred to first consumer: exact full-tier step order vs `.github/workflows/ci.yml` — pin when implementing if order affects failure semantics.

## Out of scope

- Jarvis harness fix→commit→ready orchestration (separate intent).
- Adding `lint:md` to CI (separate thread).

## Documentation updates

- `v2/docs/v1-behaviors.md` — `ready` = strict CI-parity verification; `fix` = separate pre-gate autofix.

## Prerequisites
