---
name: live-serial-test-confirmation-command
---

# Live-surface serial test confirmation command

## Problem

Scoped gate failures are confirmed by re-running the full suite serially, but bare `bun test` still discovers frozen `v1/test/**` and cannot validate live-engine health.

## Behavior

Add one `package.json` script (and backing runner wiring in `scripts/`) that runs the same union of live test surfaces as aggregate `bun run test` — v2 agent and integration slices, shared, root `test/`, and root tooling tests under `scripts/` — with per-file execution forced serial (no `--parallel` pool) and with no path or discovery that includes `v1/`.

## Acceptance criteria

- [ ] A regression test fails against the pre-fix repo and proves the new script's resolved file roster matches aggregate `bun run test` live surfaces and contains no path under `v1/`.
- [ ] A regression test fails against the pre-fix repo and proves the confirmation entrypoint runs without `--parallel` (concurrency 1 or equivalent single-lane scheduling).
- [ ] `bun run typecheck` and `bun run test:shared` pass.

## Documentation updates

- `v2/docs/test-writing.md` — name the confirmation script and when operators or agents use it versus scoped `test:*` gates.

## Prerequisites
