---
name: cleanup-archives-workflow-specs-in-one-run
---

# Cleanup archives workflow specs in one run

`jarvis cleanup` resolves a retired worktree's spec from workflow-shaped durable runs and archives an eligible completed artifact during that same invocation. An immediate second cleanup has nothing newly archivable.

## Decisions

- Resolve retirement artifacts across workflow step rows by their recorded spec identity; rules out an omitted `stepId` lookup that selects only ad-hoc rows.
- Make selection of a no-step ad-hoc run explicit in the state-store call contract; rules out omitted `stepId` silently meaning `step_id IS NULL`.
- Exclude a worktree retired in the current invocation from ownership of its own artifact; rules out deferring archival to a second cleanup.
- Keep per-retirement archival as the primary path and stranded scanning as the fallback; rules out replacing targeted resolution with a whole-store sweep.
- Preserve completeness, open-PR, other-owner, proven-intent, and durable-row semantics; rules out weakening archival safety to fix identity resolution.

## Prerequisites

- `jarvis cleanup` retires merged v2 worktrees and archives eligible completed artifacts from durable spec paths.

## Acceptance criteria

- A single confirmed cleanup retires a workflow-produced worktree and archives its eligible completed spec without `no durable spec identity` output.
- A worktree retired during the invocation does not block archival of its own spec, and an immediate second cleanup finds nothing newly archivable.
- `v2/src/commands/cleanup.test.ts` adds a real workflow-row regression with a non-null step identity; it fails before the fix and passes after it.
- Incomplete workflow-produced specs remain at the open home and name the unchecked criterion.
- Ad-hoc no-step runs retain current archival behavior through an explicit no-step lookup contract.
- `v2/src/commands/cleanup.test.ts` retirement-failure, open-PR/other-owner, and consumed-intent tests stay green; `v2/src/commands/cleanup-artifacts.test.ts` durable-row tests stay green.
- `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — cleanup archives eligible retired workflow specs in one invocation; remove rerun implications for this path.
- `v2/docs/v1-behaviors.md` — record the corrected v2 retirement-archival behavior.
