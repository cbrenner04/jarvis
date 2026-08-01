---
name: mutation-verifier-excludes-test-files
---

# Mutation verification excludes test files from candidate selection

Splitting does not apply: one execution-loop surface (`diff-scan` / `diff-derived-mutation-verifier`); operator-runbook documents the same gate contract.

## Problem

`diff-derived-mutation-verifier` derives mutation candidates from every changed code path whose extension passes `isCodePath`, but `isProductionFile` only excludes `*.test.ts` / `*.test.js`. Changed `*.test.tsx` lines (e.g. `tui-entry.test.tsx:119`) still produce candidates; flipping fixture helpers can survive scoped tests and strand the run at `surviving_mutation_failed` with no valid recovery.

## Decisions

- Mutation candidates come from production sources only; test files are excluded from the candidate set — rules out demanding a red suite for a mutation the suite cannot observe.
- Exclusion follows the repo test-file convention (`*.test.ts`, `*.test.tsx`, `*.sandbox-unrunnable.test.ts`), not a per-file opt-out list — rules out a drifting allowlist.
- A diff whose changed code paths are all test files yields no mutation candidates and completes verification — rules out stranding a pure test refactor.
- Align `isProductionFile` in `diff-scan.ts` (shared by mutation, runtime-smoke, and uncovered-line verifiers) — rules out a mutation-only filter that diverges from other completion verifiers.
- Out of scope: whether a surviving production mutation should be retryable, and the existing `mutation_repair_exhausted` path.

## Acceptance criteria

- [ ] A changed line in a `*.test.ts` or `*.test.tsx` file produces no mutation candidate; `diff-derived-mutation-verifier.test.ts` fails against pre-fix code.
- [ ] A diff whose changed code paths are all test files completes mutation verification with no surviving-mutation failure; `diff-derived-mutation-verifier.test.ts` fails against pre-fix code.
- [ ] A changed production line in the same diff still produces candidates and still fails when its mutation survives; `diff-derived-mutation-verifier.test.ts` fails against pre-fix code.
- [ ] The exclusion covers `*.test.tsx` and `*.sandbox-unrunnable.test.ts`, proved by fixture paths in `diff-derived-mutation-verifier.test.ts`, not only `*.test.ts`.
- [ ] Inverting the new non-production classifier in `diff-scan.ts` fails a test in `diff-derived-mutation-verifier.test.ts`.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Gate trust — mutation verification inspects production diff paths only; test-file changes are not mutation candidates and will not surface `surviving_mutation_failed`.

## Prerequisites

- `diff-derived-mutation-verifier` derives candidates from `<runBase>...HEAD` changed lines filtered through `isProductionFile` and `isCodePath`.
- `v2/docs/operator-runbook.md` § Gate trust documents `surviving_mutation_failed` recovery for production-site mutations.
