# 02 — Agent and runbook test-scope documentation

## Problem

`AGENTS.md`, `CLAUDE.md`, `v2/docs/operator-runbook.md`, `v2/docs/operator-practices.md`, and `v2/docs/test-writing.md` still describe `test:shared` / `test:integration:shared`, four-slice CI scope, and serial re-run guidance tied to the retired runner.

## Decisions

- Document a single scoped pair (`test:v2`, `test:integration:v2`) for `v2/**`, `v2/src/shared/**`, root `test/**`, and `scripts/**/*.test.ts` — rules out documenting a parallel shared slice after subspec 01.
- Serial in-sandbox retry for scoped failures uses `JARVIS_TEST_CONCURRENCY=1 bun run test:v2` (or `bun test <file>`) for all folded paths — rules out `test:shared`-specific parallel-runner guidance in agent and operator docs.

## Tasks

- [x] Update `AGENTS.md` and `CLAUDE.md` test-scope and sandbox-retry bullets per decisions.
- [x] Update `v2/docs/operator-runbook.md` ready-gate / CI-vs-aggregate section for two-slice scope (no retired script names).
- [x] Update `v2/docs/operator-practices.md` CI path-scope bullet and `v2/docs/test-writing.md` serial retry prose per decisions.

## Acceptance criteria

- [x] `AGENTS.md` and `CLAUDE.md` contain no `test:shared` or `test:integration:shared` references.
- [x] `v2/docs/operator-practices.md` and `v2/docs/test-writing.md` contain no `test:shared` or `test:integration:shared` references.
- [x] `v2/docs/operator-runbook.md` ready-gate and CI-vs-aggregate prose names only `test:v2` and `test:integration:v2` for code-bearing diffs under `v2/**`, `v2/src/shared/**`, `test/**`, and `scripts/**/*.test.ts` (no shared slice scripts; aggregate roster prose matches two scoped slices).
- [x] `AGENTS.md` scoped-test bullets map `v2/**`, `v2/src/shared/**`, `test/**`, and `scripts/**/*.test.ts` to `test:v2` + `test:integration:v2` only.
- [x] `bun run typecheck` passes.
- [x] `bun run lint:md` passes (authored markdown touched).

## Documentation updates

- `AGENTS.md` and `CLAUDE.md` — test-scope rules: no shared slice; root `test/**` and `scripts/**/*.test.ts` map to the `v2` slices.
- `v2/docs/operator-runbook.md` — gate and ready-check scoped script names.
- `v2/docs/operator-practices.md` — CI path-scope table prose.
- `v2/docs/test-writing.md` — serial retry guidance for scoped failures.
