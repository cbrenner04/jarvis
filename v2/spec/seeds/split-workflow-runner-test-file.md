---
name: split-workflow-runner-test-file
---

# Split `workflow-runner.test.ts` so no single test file approaches the per-file health budget (durable #2181 fix)

## Problem

`v2/src/execution/workflow-runner.test.ts` is 11,881 lines / 222 tests and runs right at the 180s `SUPPORTED_HEALTHY_FILE_BUDGET_MS` (`scripts/run-v2-tests.ts`). It is already isolated into `LOAD_SENSITIVE_FILES` (no co-runners) yet still sits at the edge, so any PR that adds a couple of tests to it tips the file deterministically over the budget and red-gates CI — this is why #2981 (`ready-gate-failure-detail-names-the-gate-output`, 2 resume-path tests) cannot merge. A temporary stopgap raised the budget to 420_000 (see the `TEMPORARY STOPGAP (#2181)` comment in `run-v2-tests.ts` and the parity assertion in `test/test-slices.test.ts`); this seed is the durable fix that lets the budget go back to 180_000.

The design intent is that 180s is a **health threshold** (the constant is literally `SUPPORTED_HEALTHY_FILE_BUDGET_MS` and the runner refuses any per-file timeout below it) — so the fix is to split the oversized file, not permanently raise the ceiling.

## Decisions

- Split `workflow-runner.test.ts` into several co-located `workflow-runner-*.test.ts` files grouped by concern, each running comfortably under the 180s budget. Its 16 top-level `describe` blocks group naturally, e.g.: preset/dispatch (`resolveWorkflowPreset`, `executeWorkflow`, `executeWorkflow fresh dispatch`), completion publication, review (`review dispatch` — the ~3.5k-line giant — plus `review-debate dispatch`, `implement patch review`, `implement patch light review`, `review actuator staged Markdown lint`, `plan review dispatch`), and recovery/telemetry (`recoverPlanStage`, `load-time role validation`, `telemetry`, `linked implement routing`, `intent publication input consumption`). Rules out leaving it one file, or a line-count split that ignores runtime balance — balance by runtime so each file clears the budget with margin.
- Peel the resume-path tests into their own file (`workflow-runner-resume.test.ts` or the recovery file) so #2981-style resume additions have headroom and land there. Rules out re-concentrating resume tests in a file already at the edge.
- **Preserve every test exactly** — same test titles, same assertions, same `// @mutate` / keystone directives, no test dropped or renamed. The total `test()`/`it()` count across the new files must equal the pre-split count (222, plus whatever the same branch legitimately adds). Rules out silent loss during the move (diff the count before/after).
- Each new file keeps the shared imports/helpers it needs (extract common setup into a sibling helper module if duplication is large, rather than copy-paste drift). Rules out a helper file that itself imports test-only globals incorrectly.
- Keep every new file in `LOAD_SENSITIVE_FILES` if it still warrants isolation, or remove that isolation for files that no longer need it — decide per resulting file by its measured runtime. Rules out blindly carrying the whole-file isolation onto every fragment.
- Revert the stopgap: restore `SUPPORTED_HEALTHY_FILE_BUDGET_MS = 180_000` in `run-v2-tests.ts` (and its stopgap comment) and the `test/test-slices.test.ts` parity assertion back to `= 180_000`. Rules out leaving the budget permanently inflated.

## Acceptance criteria

- [ ] `v2/src/execution/workflow-runner.test.ts` is split into multiple co-located `workflow-runner-*.test.ts` files; the original monolith no longer exists (or retains only a small residual well under budget) — pinned by the files existing and the line count per file being materially smaller.
- [ ] The total number of `test()`/`it()` cases across the resulting files equals the pre-split total (no test dropped or renamed) — verify by counting on the merge base vs the branch; state both counts in the PR body.
- [ ] Each resulting `workflow-runner-*.test.ts` file runs under the 180s per-file budget with margin (measure and report each file's wall clock).
- [ ] `SUPPORTED_HEALTHY_FILE_BUDGET_MS` is restored to `180_000` in `scripts/run-v2-tests.ts` and the `test/test-slices.test.ts` parity assertion is restored to `= 180_000`; the stopgap comments are removed.
- [ ] `bun run typecheck` and `bun run test` (full — root tooling touched) pass, including the aggregate/ready gate at the restored 180s budget.

## Documentation updates

- `v2/docs/test-writing.md` — note the `workflow-runner-*.test.ts` split and the rule that a single test file must stay under the per-file health budget (split when it approaches it).
