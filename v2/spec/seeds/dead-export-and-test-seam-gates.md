---
name: dead-export-and-test-seam-gates
---

# Real dead-export gate; retire the pinned-symbol test and the fence bypass

## Problem

`export-surface-trim.test.ts` pins 7 symbols from one historical cleanup and enforces nothing general: the 2026-08-29 review found 156 exported types and 42 exported values referenced nowhere outside their own file, and 6 fully dead exports (`isWriteLoopOutcomeKind` `write-loop.ts:136`, `cleanupVerdictFile` `review-intent-enforcement.ts:323`, `describeInertHeadline` `mutation-checkpoint-verifier.ts:499`, plus three in `testing/`). Separately, `bypassPersistedReadyGateRepairFenceForTest` — a safety-fence bypass — is threaded through production types and three production call sites (`write-loop.ts:289,968`; `workflow-runner.ts:3914,3969,4415`), and `workflow-runner.test-support.ts` (571 lines) sits in the production source glob.

## Decisions

- A `knip`/`ts-prune`-style gate over `v2/src` runs in `bun run check`, with an explicit allowlist for intentional public surface; `export-surface-trim.test.ts` is deleted. Rules out the 7-symbol pin masquerading as coverage.
- The 6 dead exports are deleted; unreferenced-outside-own-file exports are demoted to module-private as the gate's first sweep (mechanical, no behavior change). Rules out carrying a known-dead surface under a green gate.
- The ready-gate repair-fence bypass moves behind an injected test-only seam (or the tests restructure to not need it); no production type carries a `ForTest` bypass of a safety fence. Rules out a fence whose off-switch ships in the product.
- `test-support` files are excluded from the production glob (naming or tsconfig), so support code cannot be imported by production modules unnoticed. Rules out the silent inclusion.

## Acceptance criteria

- [ ] The gate turns red on a newly added unreferenced export and is green on the swept tree, pinned by a gate self-test.
- [ ] The 6 dead exports are gone and the demotion sweep landed with zero behavior diffs, pinned by typecheck + full tests.
- [ ] No production type or call path carries the repair-fence bypass, pinned by grep-level absence plus the restructured tests staying green.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/coding-standards.md` — export hygiene gate, test-support placement, no `ForTest` seams in production.
