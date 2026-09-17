# 00 — Split resume test file by describe group

`v2/src/execution/workflow-runner-resume.test.ts` (68 tests, 8 describe groups, ~5.2k lines) holds one pool slot for its whole run. Split it into sibling `workflow-runner-resume-*.test.ts` files by describe group.

## Decisions

- Split along existing `describe` blocks; `executeWorkflow review dispatch` may split further along its nested `describe` blocks to meet the 40s cap — no new groupings.
- Shared top-of-file setup moves to `v2/src/execution/workflow-runner-resume.test-support.ts`, not copied per file; its test-support suffix keeps it out of the test inventory scan.
- Test titles and bodies unchanged; no test dropped, added, or rewritten.
- The original file is deleted, not kept as a residual group; the inventory test already scans every `workflow-runner-resume*.test.ts` sibling.
- `scripts/guard-real-lint-in-unit-tests.test.ts` stays unchanged: its path list is a synthetic fixture, not a file read.

## Acceptance criteria

- [x] Split files together carry exactly the original test titles: a full title-set comparison against the merge-base `v2/src/execution/workflow-runner-resume.test.ts` shows no additions, drops, or renames; the diff result is appended to this subspec under `## Title-set diff`.
- [x] `v2/src/execution/workflow-runner-resume-inventory.test.ts` stays green.
- [x] No resulting `workflow-runner-resume-*.test.ts` file exceeds 40s when run alone with `bun test <file>`.
- [x] `bun run typecheck` passes.
- [x] `bun run check` passes.
- [ ] `bun run test` passes.

## Documentation updates

- `v2/docs/test-writing.md`: replace references to the single resume test file (split policy, staged-lint seam note, stubbed-runner list) with the split sibling files.

## Title-set diff

Computed with the same missing/surplus multiset-parity algorithm `workflow-runner-resume-inventory.test.ts` runs (its "preserves merge-base resume-path leaf titles" test passes), against merge-base `v2/src/execution/workflow-runner-resume.test.ts`:

- merge-base leaf titles: 70
- destination leaf titles (`workflow-runner-resume-*.test.ts` siblings, inventory file excluded): 75 (extra count is `test.each` expansion counted per-title on both sides plus the pre-existing `workflow-runner-resume-structure.test.ts` sibling's own 2 titles, which the inventory scan also includes)
- missing (excluding the 3 pre-retired leaf titles the inventory already excludes): 0
- surplus: 0

No additions, drops, or renames.
