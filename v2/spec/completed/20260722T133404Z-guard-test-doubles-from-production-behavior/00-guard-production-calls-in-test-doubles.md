# 00 - Guard production calls in test doubles

## Problem

Fixtures under `v2/src/testing/**` can compute a double's response by calling the production
behavior the double stands in for (the retired `advanceLoadedRevision` status-reply pattern).
Such a double asserts the implementation against itself. Only review catches this today.

## Decisions

- Flag *calls* of value-imported production bindings, not production imports themselves; rules out a blanket import ban that would force fixtures to duplicate shared types and constants.
- Permit only via an explicit allowlist of `<module>#<export>` entries carrying a reason; rules out name-shape heuristics ("looks like a builder"), which silently admit the next behavioral call.
- Seed the allowlist with exactly the calls the current tree makes (`../cli.ts#main`, `../persistence/state-store.ts#openStateStore`, `../daemon/daemon-lifecycle.ts#startDaemon`, `../daemon/daemon-lifecycle.ts#isProcessAlive`); rules out a permissive seed that grandfathers unreviewed future calls.
- Scan every file under `v2/src/testing/**`, not just `*.test.ts`; rules out reusing the deterministic-daemon guard's test-file filter, which would miss the fixture modules that are the entire surface here.
- Ship as a standalone script wired into `bun run check`, matching `guard-deterministic-daemon-tests.ts`; rules out a Biome rule (no cross-import analysis) or review-only enforcement.

## Task checklist

- [ ] Add `scripts/guard-test-double-production-calls.ts`: exported pure function over `{ file, source }` records returning violations, plus a `cwd`-rooted runner and `import.meta.main` CLI mirroring the deterministic-daemon guard.
- [ ] Resolve value imports from production modules (relative paths escaping `v2/src/testing/`, e.g. `../**`, `../../../shared/**`); ignore `import type` specifiers, `node:*`, `bun:test`, and sibling `./*` fixture imports.
- [ ] Report a violation for each call whose callee is such a binding and whose `<module>#<export>` is not allowlisted.
- [ ] Add `scripts/guard-test-double-production-calls.test.ts` with rejected and allowed fixture sources.
- [ ] Add the guard to the `check` script in `package.json`.
- [ ] Update docs.

## Acceptance criteria

- [x] A new `test-doubles production-call guard` test rejects the known `advanceLoadedRevision` pattern — a value import of a production dispatch helper called to compute a double's status reply — and fails against the pre-guard code.
- [x] The guard test accepts type-only production imports, imported production constants that are never called, and allowlisted builder/entry-point calls (`openStateStore`, `main`, `startDaemon`, `isProcessAlive`).
- [x] The guard scans all files under `v2/src/testing/**` (not only `*.test.ts`) and reports `<file>:<line>: <module>#<export>` on stderr, exiting non-zero when violations exist.
- [x] `bun run check` runs the guard and passes against the current tree.
- [x] Inverting each added guard condition (drop the type-only skip; drop the allowlist check; drop the production-module path check) makes at least one guard test fail; the allowlist-drop case proves the suppression itself is tested.
- [x] `bun run check`, `bun run typecheck`, and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/test-writing.md` — new section: doubles must not compute responses with the production behavior they stand in for; names the guard script, the rejected call form, the permitted type-only/constant/allowlisted-builder forms, and how to add an allowlist entry.
- `v2/docs/operator-runbook.md` — one bullet in the shipped-guards list pointing at the guard and the test-writing section, matching the deterministic-daemon-guard bullet.
