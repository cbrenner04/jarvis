---
name: mutation-verifier-skips-test-support-files
---

# Diff-derived mutation verification treats `*.test-support.*` as test code

Unsplit rationale: one small predicate change on test-code classification, shared by the verifier and the import guard; one reviewable unit.

## Primary implementation surface

- `v2/src/execution/diff-scan.ts` `isProductionFile` (`:19-22`), the diff-candidate gate consumed by `diff-derived-mutation-verifier.ts:970` via `changedPathsFromDiff` — not the killing-test resolver at `:864`, which only runs after a file already passed this gate.
- Shared predicate lives in `scripts/production-files.ts` (already exports `TEST_SUPPORT_SUFFIX` and `isProductionSourceFile`, already consumed by `scripts/guard-production-test-support-imports.ts`): extend or reuse it from `diff-scan.ts` rather than inventing a second one. `v2/src` already imports directly from `scripts/` elsewhere in this same file (`diff-derived-mutation-verifier.ts:5` imports `guarded` from `scripts/guard-deterministic-daemon-tests.ts`), so this crossing has precedent — no new layering exception needed.
- Note the two predicates aren't identical today (`isProductionSourceFile` also requires a `v2/`or `shared/` root prefix and excludes the `v2/src/testing/` harness root; `isProductionFile` excludes `test/`, `v1/`, `v2/spec/`, `v2/docs/` path prefixes instead): drafting must reconcile this, not just import one into the other blindly.

## Prerequisites

## Behavior

- A changed file whose basename matches `*.test.*` or `*.test-support.*` is test code and never a mutation candidate.
- The verifier and the production test-support import guard use the same exported predicate, so they cannot drift.
- Killing-test resolution for production files is unchanged.

## Acceptance criteria

- [ ] A test asserts a diff changing only a `*.test-support.ts` file yields no mutation candidates; it fails against the current `.test.` check.
- [ ] A test asserts a diff changing a production file and a `*.test-support.ts` file yields candidates only for the production file.
- [ ] `scripts/guard-production-test-support-imports.ts` and the verifier use the same exported predicate.
- [ ] `bun run typecheck`, `bun run test:v2`, `bun run test:shared`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` § Diff-derived mutation verification — test-support files are excluded.

## Evidence

2026-09-17, lane `daemon-retire-trigger-logging` (pipeline `cc0e8aaa`, PR #3994): review row `9eceeccb` settled `surviving_mutation_failed` on `v2/src/daemon/daemon-retire-trigger-logging.test-support.ts:24` (`importer-discovery-cap-exceeded`).
