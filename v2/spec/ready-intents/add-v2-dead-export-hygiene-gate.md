---
name: add-v2-dead-export-hygiene-gate
---

# Add a dead-export hygiene gate to bun run check

`export-surface-trim.test.ts` pins seven historical symbols and does not detect newly introduced unreferenced exports across `v2/src`.

## Primary implementation surface

- `package.json` `check` script and `scripts/guard-dead-exports.ts`

## Behavior

- A knip/ts-prune-style gate over `v2/src` production modules runs in `bun run check`, with an explicit allowlist for intentional public surface; scan scope matches other structural guards (exclude `*.test.ts`, `*.test-support.ts`, and `v2/src/testing/**`).
- `v2/src/export-surface-trim.test.ts` is deleted.

## Decision ledger

- Wire the gate into `bun run check` beside existing structural guards; rules out a standalone script operators must remember to run.
- Reuse the shared production-file predicate (same exclusions as `guard-sync-child-processes`); rules out scanning test harness exports or re-litigating `*.test-support.ts` / `v2/src/testing/` boundaries.
- Allowlist only symbols that are intentionally public but unreferenced in static analysis; rules out deleting or demoting allowlisted surface in this intent.
- Delete `export-surface-trim.test.ts` when the gate lands; rules out keeping the seven-symbol pin as parallel coverage.

## Acceptance criteria

- [ ] `scripts/guard-dead-exports.test.ts` proves the gate fails on a fixture with a newly added unreferenced export and passes on the current tree with the allowlist applied.
- [ ] `bun run check` invokes the dead-export gate and `v2/src/export-surface-trim.test.ts` is absent.
- [ ] `bun run typecheck` and `bun run test:shared` pass.

## Documentation updates

- `v2/docs/coding-standards.md` — export hygiene gate scope, production-file predicate, allowlist, and manual red-check recipe (first section in this intent chain; later intents append only).

## Prerequisites

- `*.test-support.ts` files are excluded from the v2 production source glob and production modules cannot import them unnoticed.
