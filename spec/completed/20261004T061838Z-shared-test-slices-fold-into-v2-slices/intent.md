---
name: shared-test-slices-fold-into-v2-slices
---

# The `test:shared` slices retire and every former shared test runs in a `v2` slice

## Problem

`package.json` still carries `test:shared` / `test:integration:shared`, `scripts/ci-test-scope.ts` has a `shared/` branch, and `scripts/run-v2-tests.ts` walks only `v2/`, so root `test/` and `scripts/` tests need a slice of their own once `shared/` is gone.

## Decisions

- Retire `test:shared`, `test:integration:shared`, their runner script, and the `shared/` branch of `ci-test-scope.ts`; root `test/**` and `scripts/**` tests run in the `v2` slices.
- Plan must decide whether `run-v2-tests.ts` walks `test/` and `scripts/` directly or those tests move; no test file is dropped (count pinned against the pre-change baseline).

## Prerequisites

- The moved runtime tree exists so the shared slice has nothing left to run (delivered by: shared-runtime-lives-under-v2-src)

## Acceptance criteria

- [x] `package.json` has no `test:shared` / `test:integration:shared`; `ci-test-scope.test.ts` pins that a change under the moved tree or root `test/` selects the `v2` slices only.
- [x] `run-v2-tests` discovery includes every former shared-slice file, pinned by inventory tests in subspec 00.
- [x] `bun run typecheck` and `bun run test` pass.

## Documentation updates

- `AGENTS.md` — test-scope rules: no shared slice; v2/test scoped pair; script paths → full in CI.
- `v2/docs/operator-runbook.md` — gate and ready-check script names.

## Primary implementation surface

- `package.json`, `scripts/ci-test-scope.ts`, `scripts/run-v2-tests.ts`
