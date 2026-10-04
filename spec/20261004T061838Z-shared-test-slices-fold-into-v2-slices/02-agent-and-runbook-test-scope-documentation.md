# 02 — Agent and runbook test-scope documentation

## Problem

`AGENTS.md`, `CLAUDE.md`, `v2/docs/operator-runbook.md`, `v2/docs/operator-practices.md`, and `v2/docs/test-writing.md` still describe `test:shared` / `test:integration:shared`, four-slice CI scope, and serial re-run guidance tied to the retired runner.

## Decisions

- Document agent scoped runs for `v2/**`, `v2/src/shared/**`, and root `test/**` as `test:v2` + `test:integration:v2` aligned with `scripts/ci-test-scope.ts` for those paths — rules out implying script paths share that CI narrow scope.
- Document roster membership for root `scripts/**/*.test.ts` in the v2 slices separately from CI/ready classification (`scripts/**` → `full`) — rules out conflating discovery with `classifyChangedPaths`.
- Serial in-sandbox retry for scoped failures uses `JARVIS_TEST_CONCURRENCY=1 bun run test:v2` (or `bun test <file>`) for folded roster paths — rules out `test:shared`-specific parallel-runner guidance in agent and operator docs.

## Tasks

- [x] Update `AGENTS.md` and `CLAUDE.md` test-scope and sandbox-retry bullets per decisions.
- [x] Update `v2/docs/operator-runbook.md` ready-gate / CI-vs-aggregate section for two-slice scope (no retired script names).
- [x] Update `v2/docs/operator-practices.md` CI path-scope bullet and `v2/docs/test-writing.md` serial retry prose per decisions.

## Acceptance criteria

- [x] `AGENTS.md` and `CLAUDE.md` contain no `test:shared` or `test:integration:shared` references.
- [x] `v2/docs/operator-practices.md` and `v2/docs/test-writing.md` contain no `test:shared` or `test:integration:shared` references.
- [x] `v2/docs/operator-runbook.md` ready-gate and CI-vs-aggregate prose matches `classifyChangedPaths`: `v2/**`, `v2/src/shared/**`, and root `test/**` → the two scoped slices; any `scripts/` diff → `full`; roster prose notes script tests run in those slices without narrowing CI.
- [x] `AGENTS.md` and `CLAUDE.md` scoped-test bullets match that split (v2/test paths → scoped pair; script path changes → `bun run test`; no blanket “same rule as `ci-test-scope`” for `scripts/`).
- [x] `bun run typecheck` passes.
- [x] `bun run lint:md` passes (authored markdown touched).

## Documentation updates

- `AGENTS.md` and `CLAUDE.md` — test-scope rules: no shared slice; v2/test paths → scoped pair; script roster vs CI `full`.
- `v2/docs/operator-runbook.md` — gate and ready-check scoped script names.
- `v2/docs/operator-practices.md` — CI path-scope table prose.
- `v2/docs/test-writing.md` — serial retry guidance for scoped failures.
