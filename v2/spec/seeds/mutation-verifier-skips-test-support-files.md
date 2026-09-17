---
name: mutation-verifier-skips-test-support-files
---

# Diff-derived mutation verification treats `*.test-support.ts` as test code

## Problem

The diff-derived mutation verifier (`v2/src/execution/diff-derived-mutation-verifier.ts`) excludes a changed file from mutation candidates only when its basename contains `.test.` (`:864`). This repo's test-helper convention is `*.test-support.ts` (recognized by `scripts/guard-production-test-support-imports.ts` and the dead-export guard), which does not match. So a lane that adds a test-support helper gets its guards mutated as production code; the helper has no killing test of its own and, when no co-located test resolves, importer discovery can exceed its cap and settle `surviving_mutation_failed` / `importer-discovery-cap-exceeded` — stranding a lane whose production code is fine.

## Evidence

2026-09-17, lane `daemon-retire-trigger-logging` (pipeline `cc0e8aaa`, PR #3994): after link-0, link-1 and shrink completed, the review row `9eceeccb` settled `surviving_mutation_failed` on `v2/src/daemon/daemon-retire-trigger-logging.test-support.ts:24` (`importer-discovery-cap-exceeded`). Hand-finished.

## Decisions

- A changed file is test code, and never a mutation candidate, when its basename matches `*.test.*` or `*.test-support.*`. Rules out mutating helpers that exist only to serve tests.
- The classification uses one shared predicate with the production test-support import guard, so the two cannot drift.
- No change to killing-test resolution for production files.

## Acceptance criteria

- [ ] A test asserts a diff that changes only a `*.test-support.ts` file yields no mutation candidates; it fails against the current `.test.` check.
- [ ] A test asserts a diff that changes a production file and a `*.test-support.ts` file yields candidates only for the production file.
- [ ] `scripts/guard-production-test-support-imports.ts` and the verifier use the same exported predicate.
- [ ] `bun run typecheck`, `bun run test:v2`, `bun run test:shared`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` § Diff-derived mutation verification — test-support files are excluded.
