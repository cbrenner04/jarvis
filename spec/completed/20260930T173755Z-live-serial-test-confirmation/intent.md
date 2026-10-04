---
name: live-serial-test-confirmation
---

# Serial failure confirmation runs the live roster, never frozen `v1/`

Assembled by the operator from the three chained lanes of intent PR #4249 (seed `serial-rerun-includes-frozen-v1`); one spec with chained subspecs, not a fan-out.

## Problem

Scoped gate failures are confirmed by re-running serially, but `AGENTS.md` (symlinked as `CLAUDE.md`) tells agents to run bare `bun test`, which discovers frozen `v1/test/**` and cannot validate live-engine health. Operator docs name no alternative, so hand recovery falls back to bare `bun test` too.

## Behavior

1. Add `package.json` script `test:confirm:live` with backing runner wiring in `scripts/` that runs the same union of live test surfaces as `aggregateTestFiles()` / aggregate `bun run test` — v2 agent and integration slices, shared, root `test/`, and root tooling tests under `scripts/` — with per-file execution forced serial (no `--parallel` pool) and no path or discovery under `v1/`.
2. Replace the bare `bun test` serial-confirmation instruction in `AGENTS.md` with `bun run test:confirm:live`. Keep the rule that only a serially reproducing failure is real; preserve scoped-first testing and failing-test evidence semantics.
3. Operator docs say when to run it: after a scoped `test:*` or ready step fails, before treating the failure as real or chasing flakes; frozen `v1/` is never used for confirmation.

## Acceptance criteria

- [ ] `scripts/run-confirm-live-tests.test.ts` test `confirmLiveTestFiles matches aggregateTestFiles and excludes v1` fails against the pre-fix repo.
- [ ] `scripts/run-confirm-live-tests.test.ts` test `test:confirm:live runs without parallel pool` fails against the pre-fix repo.
- [ ] `shared/prompts/implement-prompts.test.ts` test `the migrated jarvis-specific rules live in this repo's injected guidance` asserts `bun run test:confirm:live` instead of bare `bun test` and fails against the pre-fix guidance.
- [ ] `AGENTS.md` no longer tells agents to run bare `bun test` for serial failure confirmation.
- [ ] `v2/docs/operator-practices.md` and `v2/docs/operator-runbook.md` name `bun run test:confirm:live` in the gate-failure / recovery workflow and state it excludes frozen `v1/`.
- [ ] `bun run typecheck`, `bun run test:shared`, and `bun run lint:md` pass.

## Documentation updates

- `v2/docs/test-writing.md` — name `bun run test:confirm:live` and when to use it (aggregate live roster, serial) versus scoped `test:*` gates.
- `v2/docs/v1-behaviors.md` — agent mid-work serial retry and implement-rules catalog entries cite `bun run test:confirm:live`, not bare `bun test`.
- `v2/docs/prompts.md` — jarvis-specific serial confirmation lives in `AGENTS.md` via `test:confirm:live`.
- `v2/docs/operator-practices.md`, `v2/docs/operator-runbook.md` — as in the criteria above.

## Prerequisites

None.
