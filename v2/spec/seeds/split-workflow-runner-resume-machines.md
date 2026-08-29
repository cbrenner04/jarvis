---
name: split-workflow-runner-resume-machines
---

# Split workflow-runner's resume machines; merge the copy-pasted twins

## Problem

`workflow-runner.ts` is 5,141 lines / 13 responsibilities (2026-08-29 review). Two coherent cuts carry most of the weight: the three resume machines (plan recovery, intent finalization, review mutation; lines 2902–4510, ~1,600 lines) and review-debate landing (1848–2900). Inside the resume block, intent finalization (`:3362-3737`) and review mutation (`:3738-4510`) are copy-paste twins — `settleIntentResumeFailure:3435` hardcodes `resumable: true` while its twin `:3918` computes it from outcome kinds and carries the comment explaining why a blanket `true` is wrong; the paste left five dead single-use `message` aliases (`:1237,3450,3618,3932,4334`). Its test file is the #2181 budget-flake offender (~224 tests at the 180s per-file edge), which red-gates unrelated PRs and blocks any spec adding a runner test.

## Decisions

- Extract the resume machines and review-debate landing into sibling modules; `workflow-runner.ts` keeps the step loop and dispatch. Rules out the 5k-line file staying the merge hotspot.
- Merge the twin resume machines onto one parameterized implementation whose `resumable` is computed for both callers — the intent path's blanket `true` is the bug, the computed path is the spec. Rules out preserving both copies.
- Tests move with their modules; `workflow-runner.test.ts` splits along the same seams so no single file sits at the per-file budget edge — this subsumes issue #2181 and the demoted `workflow-runner-test-concurrent-load-isolation` seed. No test deleted or skipped; count and assertions match pre-split (diff the test inventory against baseline before merge).
- Pure module moves and the `resumable` fix only; no behavior redesign rides along. Rules out scope creep into settlement semantics ([[pipeline-settlement-derives-from-run-rows]] owns that).

## Acceptance criteria

- [ ] `workflow-runner.ts` no longer contains the resume machines or review-debate landing; each lives in a named module with its tests, pinned by file-size/structure assertions in review.
- [ ] Intent-finalization resume computes `resumable` from outcome kinds; a non-resumable outcome no longer advertises `resumable: true`, pinned by a test that fails against the hardcoded value.
- [ ] Test inventory matches the pre-split baseline (count + titles), pinned by a recorded comparison.
- [ ] No post-split test file exceeds the per-file budget with margin under load, and `bun run typecheck` + `bun run test:v2` + `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — module map after the split.
- `v2/docs/test-writing.md` — where runner tests live now; per-file budget note referencing the split.
