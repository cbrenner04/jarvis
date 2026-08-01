# 00 - Exclude test paths from mutation candidate selection

## Problem

`diff-derived-mutation-verifier` derives mutation candidates from changed code paths that pass `isCodePath`, but `isProductionFile` in `diff-scan.ts` only excludes `*.test.ts` and `*.test.js`. Changed `*.test.tsx` lines (e.g. `tui-entry.test.tsx:119`) still produce candidates; flipping fixture helpers can survive scoped tests and strand the run at `surviving_mutation_failed` with no valid recovery.

## Decisions

- Mutation candidates come from production sources only; test files are excluded from the candidate set — rules out demanding a red suite for a mutation the suite cannot observe.
- `isProductionFile` treats paths whose basename contains `.test.` as non-production — same rule as `scripts/guard-production-test-flags.ts` `isTestFile` — rules out completion verifiers and the production-test-flag guard drifting on test-path classification.
- A diff whose changed code paths are all test files yields no mutation candidates and completes verification — rules out stranding a pure test refactor.
- Align `isProductionFile` in `diff-scan.ts` (shared by mutation, runtime-smoke, and uncovered-line verifiers) — rules out a mutation-only filter that diverges from other completion verifiers.
- No production `setInvert*ForTest` / `invert*ForTest` hooks — rules out test-only bypasses in `isProductionFile`.
- Out of scope: whether a surviving production mutation should be retryable, and the existing `mutation_repair_exhausted` path.

## Tasks

- Update `isProductionFile` in `v2/src/execution/diff-scan.ts`: replace the `*.test.ts` / `*.test.js` suffix patterns with a basename `.test.` exclusion matching `isTestFile`; keep other non-production path prefixes unchanged.
- Add pinning tests in `v2/src/execution/diff-derived-mutation-verifier.test.ts` for `.test.ts`, `.test.tsx`, and `.sandbox-unrunnable.test.ts` exclusion, all-test diff pass-through, and mixed diff production survival.
- Add a guard-inversion subcase with a `Mutation checkpoint:` comment naming the `.test.` basename exclusion mutation on `v2/src/execution/diff-scan.ts`; flipping that exclusion must RED the subcase against the real guard source.
- Update docs per **Documentation updates**.

## Acceptance criteria

- [ ] `diff-derived-mutation-verifier.test.ts` — a changed line in a `*.test.ts` file whose content would otherwise yield a guard or comparison mutation produces `pass` with `candidateCount: 0`; fails against pre-fix code.
- [ ] `diff-derived-mutation-verifier.test.ts` — a diff whose only changed code paths are test files (fixture includes at least one `*.test.tsx` and one `*.sandbox-unrunnable.test.ts` path) completes verification with `pass` and `candidateCount: 0`, not `surviving-mutation`; fails against pre-fix code.
- [ ] `diff-derived-mutation-verifier.test.ts` — a mixed diff with both a changed test file and a changed production file still derives candidates from the production line and reports `surviving-mutation` when scoped tests stay green; fails against pre-fix code for the test-only half of the contract.
- [ ] `diff-derived-mutation-verifier.test.ts` — inverting the `.test.` basename exclusion on `isProductionFile` in `v2/src/execution/diff-scan.ts` (per the pinning-test `Mutation checkpoint:` comment naming that mutation) makes the test-file exclusion subcase RED.
- [ ] `diff-derived-mutation-verifier.test.ts` stays green for existing candidate derivation, scoped-test execution, restoration, bounds, and masking behavior (behavior unchanged outside test-path filtering).
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Gate trust — mutation verification inspects production diff paths only; test-file changes (basename contains `.test.`) are not mutation candidates and will not surface `surviving_mutation_failed`.
- `v2/docs/v1-behaviors.md` — diff-derived mutation verification bullet: candidate selection excludes repo test paths (basename contains `.test.`, covering `*.test.ts`, `*.test.tsx`, `*.sandbox-unrunnable.test.ts`, etc.), not only production-line changes.
