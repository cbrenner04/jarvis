---
name: mutation-verifier-skips-test-support-files
---

# Diff-derived mutation verification treats `*.test-support.*` as test code

Unsplit rationale: one small predicate change on test-code classification, shared by the verifier and the import guard; one reviewable unit.

## Primary implementation surface

- `v2/src/execution/diff-derived-mutation-verifier.ts` test-code classification (`:864`), using one exported predicate shared with `scripts/guard-production-test-support-imports.ts`.

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
