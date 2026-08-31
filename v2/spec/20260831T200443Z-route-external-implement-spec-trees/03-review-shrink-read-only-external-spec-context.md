# Review and shrink read-only external spec context

Terminal shrink and implement review prompts build `SPEC_TREE` from `readSpecTree(worktreePath, specPath)`. Absolute `specPath` already loads external bodies on main, but entry labels use `relative(worktreePath, externalFile)` escape paths; review/shrink still run against code edits in the worktree.

## Decisions

- For `externalPlanSpec` runs, label shrink/review `SPEC_TREE` entries under `specReadRoot` (not `relative(worktreePath, externalFile)` escape paths); rules out mislabeled external spec context in post-implement prompts.
- No read-path code changes are required beyond label semantics when `readSpecTree` already reads absolute external bodies via `step.specPath`; rules out no-op call-site churn.
- Keep shrink and review `cwd` on the materialized code worktree; rules out moving post-implement roles into the external plan directory.
- Do not expose write paths or actuator contracts that mutate the external spec tree during review or shrink; rules out review-time criteria or index mutation on external bytes.
- `verdict-patch.md` placement beside an absolute external `specPath` already satisfies the POSIX `join(cwd, dirname(absoluteSpecPath), …)` contract on main; document in `05`, do not re-implement unless resume surfaces a relative `specPath` failure.
- Preserve in-repo shrink/review prompt and immutability behavior when `externalPlanSpec` is absent.

## Tasks

- Update `readSpecTree` (or shrink/review call sites) so external `SPEC_TREE` entry labels are rooted under admitted `specReadRoot` while keeping enforcement scoped to the worktree.
- Add a workflow regression with `reviewPasses: 0` that asserts shrink `SPEC_TREE` labels are rooted under `specReadRoot` and that shrink bindings never write under `specReadRoot`.

## Acceptance criteria

- [ ] `v2/src/execution/workflow-runner-debate.test.ts` regression drives terminal shrink for an external linked implement completion, asserts `SPEC_TREE` entry labels are rooted under admitted `specReadRoot` (not `relative(worktreePath, externalFile)` escape paths), and fails against the pre-fix label path on main today.
- [ ] `v2/src/execution/workflow-runner-debate.test.ts` regression drives terminal shrink for an external linked implement completion and proves no file under `specReadRoot` changes during shrink; it fails against the pre-fix shrink path that could mutate external bytes.
- [ ] `v2/src/execution/workflow-runner-debate.test.ts` `executeWorkflow implement patch review` stays green (in-repo shrink + review unchanged).

## Documentation updates

- None in this subspec; `05` owns operator-facing docs.
