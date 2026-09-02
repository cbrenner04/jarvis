# Pin resume test inventory

## Problem

Co-locating and splitting resume-path tests can drop or rename cases silently; the intent requires merge-base parity for every resume-path case moved out of `workflow-runner-resume.test.ts`, `workflow-runner-plan.test.ts`, `workflow-runner-publication.test.ts`, and `recover-review-failed-plan-draft.test.ts`, but no guard exists yet (`workflow-runner-resume-inventory.test.ts` is absent on merge-base).

## Surface

Primary: `v2/src/execution/workflow-runner-resume-inventory.test.ts` (new).

## Prerequisites

- Subspec 00 complete: `workflow-runner-resume.ts` exists with exported resume entrypoints.

## Decision ledger

- New `workflow-runner-resume-inventory.test.ts` compares merge-base to branch for every resume-path case inventoried from the four source files on merge-base; rules out manual diff review as the only parity check.
- Inventory scope is resume-path cases only — not every test in the four source files; rules out failing when unrelated plan-dispatch or publication cases remain in place.
- On merge-base, collect titles from `workflow-runner-resume.test.ts` in full, from `workflow-runner-plan.test.ts` under `describe("recoverPlanStage")`, from `recover-review-failed-plan-draft.test.ts` under `describe("recoverPlanStage review-failed admission")` in full, and zero cases from `workflow-runner-publication.test.ts` (no direct resume-module imports or entrypoint calls on merge-base); rules out inventing publication moves with no merge-base anchor.
- Net-new co-located resume test files from subspec 02 are additive destinations; parity asserts moved titles appear in `workflow-runner-resume*.test.ts` with unchanged counts per source bucket; rules out requiring path-keyed equality across the full execution test glob.
- Merge-base ref resolves via `git merge-base HEAD main`; empty or failed resolution fails the test explicitly; rules out silent skip or ad-hoc base selection.
- Scanner expands `test.each` rows into leaf titles (`<describe chain> > <template with row substituted>`); rules out counting only the outer `test.each` template as one case.
- Comparison keys on expanded leaf titles from `test(...)` / `test.skip(...)` / `test.each(...)` and nested `describe` paths; rules out assertion-expression or mutate-directive parity in this slice.

## Task checklist

- Add `workflow-runner-resume-inventory.test.ts` that resolves merge-base via `git merge-base HEAD main`, loads merge-base resume-path inventories from the four source files per the scope above, and asserts equal per-source case counts and unchanged leaf-title sets against post-move `workflow-runner-resume*.test.ts` destinations.
- Add a minimal local title scanner for `test(...)` / `test.skip(...)` / `test.each(...)` row expansion when no reusable helper exists on merge-base.

## Acceptance criteria

- [ ] `workflow-runner-resume-inventory.test.ts` exists with merge-base resolution, `test.each` row expansion, and per-source resume-path scanners for `workflow-runner-resume.test.ts`, `workflow-runner-plan.test.ts` (`describe("recoverPlanStage")` only), `recover-review-failed-plan-draft.test.ts` (`describe("recoverPlanStage review-failed admission")` in full), and the zero-case `workflow-runner-publication.test.ts` bucket; it fails against the pre-fix tree where the file does not exist.
- [ ] `bun run typecheck` passes.

## Documentation updates

None — inventory guard is self-describing in its test header.
