# Archive workflow specs during retirement

## Decision ledger

- Resolve a retiring worktree's artifact across its durable workflow rows by recorded spec identity; rules out selecting only an ad-hoc no-step row.
- Require an explicit no-step selector for ad-hoc `(project, branch)` lookup; rules out omitted `stepId` implicitly meaning `step_id IS NULL`.
- Exclude the successfully retired worktree from artifact ownership checks in the same invocation; rules out requiring a second cleanup.
- Keep per-retirement archival primary and stranded discovery fallback-only; rules out replacing targeted resolution with a whole-store sweep.
- Preserve completeness, open-PR, other-owner, proven-intent, transactional-move, and durable-row semantics; rules out weakening archival guards or deleting run history.

## Work

- Make the state-store resume lookup distinguish explicit no-step runs from workflow step runs.
- Resolve a retired worktree's durable spec identity across workflow and ad-hoc rows.
- Evaluate post-retirement ownership without the removed worktree.
- Add cleanup and state-store regression coverage.
- Align the operator runbook and v1 behavior catalog.

## Acceptance criteria

- [x] One confirmed `jarvis cleanup` retires a workflow-produced worktree and archives its eligible completed spec without reporting `no durable spec identity`; an immediate second cleanup archives nothing new.
- [x] A `v2/src/commands/cleanup.test.ts` regression uses a durable run row with non-null `stepId`, fails against the pre-fix code, and passes after the change.
- [x] An incomplete workflow-produced spec remains in its open home and cleanup names its unchecked acceptance criterion.
- [x] `findRunByProjectBranch` callers select ad-hoc no-step runs explicitly, and `v2/src/persistence/state-store.test.ts` pins that lookup separately from step-scoped workflow rows.
- [x] `v2/src/commands/cleanup.test.ts` retirement-failure, open-PR/other-owner, and consumed-intent coverage stays green.
- [x] `v2/src/commands/cleanup-artifacts.test.ts` durable-row and transactional archival coverage stays green.
- [x] `v2/docs/operator-runbook.md` states that eligible retired workflow specs archive in the same cleanup invocation, with no rerun implication for that path.
- [x] `v2/docs/v1-behaviors.md` records the corrected v2 retirement-archival behavior.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — document same-invocation workflow-spec archival and remove rerun guidance for this path.
- `v2/docs/v1-behaviors.md` — record the corrected v2 retirement-archival behavior.
