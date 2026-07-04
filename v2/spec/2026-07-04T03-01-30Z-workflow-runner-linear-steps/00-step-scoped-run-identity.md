# Step-scoped run identity in durable state

`runs`/`attempts` resume on `(project, branch)` only — one durable run per
worktree. A multi-step workflow needs each step's loop to keep its own
attempt history under the same `(project, branch)`, so a workflow-level
resume can tell which steps are already done and which is mid-loop.

## Decisions

- Add a nullable `step_id` TEXT column to `runs` (migration
  `005-run-step-id`), not a new `steps` table — reuses the existing
  attempt-history machinery per step rather than duplicating it.
- Resume key becomes `(project, branch, step_id)`. `step_id` omitted (`null`)
  is exactly today's single-step key — existing callers, CLI, and tests are
  unaffected.
- `step_id` is an opaque caller-supplied string (the workflow runner's step
  identifier); this slice does not interpret it.

## Task Checklist

- [ ] Add migration `005-run-step-id` (nullable `step_id` on `runs`).
- [ ] `createRun` accepts optional `stepId`.
- [ ] `findRunByProjectBranch` accepts optional `stepId` and resolves
      independently per `(project, branch, stepId)`.
- [ ] `loadRun` / `Run` surface the stored `stepId`.

## Acceptance criteria

- [ ] `write-loop.test.ts` stays green with no call site passing `stepId`
      (single-step behavior unchanged by the schema addition).
- [ ] Two `createRun` calls with the same `(project, branch)` but different
      `stepId` values produce independently resolvable runs: each
      `findRunByProjectBranch({ project, branch, stepId })` returns only the
      matching row and never the other step's run.
- [ ] `loadRun` returns the run's `stepId` alongside its attempt history.

## Documentation updates

- `v2/docs/state-store.md`: document `step_id` in the `runs` schema row,
  the `005-run-step-id` migration, and the extended resume key.
- `v2/docs/write-behavior.md`: qualify "Resume identity is `(project,
  branch)` only" as the no-`stepId` (single-step) case.
