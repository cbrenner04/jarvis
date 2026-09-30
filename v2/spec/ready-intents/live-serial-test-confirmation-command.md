---
name: live-serial-test-confirmation-command
---

# Live-surface serial test confirmation command

## Problem

Scoped gate failures are confirmed by re-running the aggregate live roster serially (not by re-running only the failing scoped `test:*` slice), but bare `bun test` still discovers frozen `v1/test/**` and cannot validate live-engine health.

## Behavior

Add `package.json` script `test:confirm:live` (`bun run test:confirm:live`) with backing runner wiring in `scripts/` that runs the same union of live test surfaces as `aggregateTestFiles()` / aggregate `bun run test` — v2 agent and integration slices, shared, root `test/`, and root tooling tests under `scripts/` — with per-file execution forced serial (no `--parallel` pool) and with no path or discovery that includes `v1/`.

## Acceptance criteria

- [ ] `scripts/run-confirm-live-tests.test.ts` test `confirmLiveTestFiles matches aggregateTestFiles and excludes v1` fails against the pre-fix repo.
- [ ] `scripts/run-confirm-live-tests.test.ts` test `test:confirm:live runs without parallel pool` fails against the pre-fix repo.
- [ ] `bun run typecheck` and `bun run test:shared` pass.

## Documentation updates

- `v2/docs/test-writing.md` — name `bun run test:confirm:live` and when operators or agents use it (aggregate live roster, serial) versus scoped `test:*` gates.

## Prerequisites
