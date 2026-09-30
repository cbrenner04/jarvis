---
name: completion-boundary-terminal-stamps-finished-at
---

# Terminal `commitCompletionBoundary` writes always stamp `finished_at`

## Problem

The completion-boundary fallback `UPDATE` in `v2/src/persistence/state-store.ts` sets terminal `status` without `finished_at` whenever the caller supplies no terminal settlement evidence. Consumers keying on `finished_at` (session-log retention, incident candidates) misread those rows; `state-store.test.ts` currently pins the null contract.

## Decisions

- When `runStatus` is terminal and settlement evidence is absent, the fallback run-row `UPDATE` stamps `finished_at` in the same statement as `status` and `status_changed_at` (same timestamp semantics as the settlement branch).
- Nonterminal completion boundaries keep the existing status-only update (no terminal `finished_at` stamp).

## Acceptance criteria

- [ ] `state-store.test.ts` proves a terminal `commitCompletionBoundary` with no settlement evidence records a non-null `finished_at`; it fails against the current fallback `UPDATE` (replace or supersede the test that expects `finishedAt` null).
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/state-store.md` — terminal run rows always carry `finished_at`, including completion-boundary terminal writes without settlement evidence; remove the “null by design” finish-source exception.
- `v2/docs/v1-behaviors.md` — revise the completion-boundary `finished_at` bullet: settlement already stamps; record that the no-settlement-evidence fallback now stamps `finished_at` too (drop “null by design”).

## Prerequisites
