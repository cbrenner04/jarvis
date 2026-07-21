---
name: cleanup-stranded-owner-by-branch
---

# Match stranded spec owners by branch

## Outcome

- `jarvis cleanup` archives an eligible completed open-home spec when unrelated materialized worktrees merely contain its path.
- A materialized worktree on the spec's implementation branch still blocks archival.

## Decisions

- Identify a stranded spec owner by matching the discovered worktree branch to the spec branch; rules out file presence at the merged spec path as ownership.
- Keep the existing materialized-owner refusal for a branch match; rules out archiving a spec while its implementation worktree remains materialized.

## Acceptance criteria

- [ ] A completed, merged open-home spec is eligible for archival while an unrelated materialized worktree on `main`, or another ref containing the spec path, exists.
- [ ] A materialized worktree whose branch matches the spec branch prevents archival with the existing ownership refusal.
- [ ] The stranded-spec regression test in `v2/src/commands/cleanup.test.ts` distinguishes unrelated file presence from a matching implementation branch and fails before the change.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — define branch-keyed ownership for stranded archival and remove file-presence guidance.
- `v2/docs/v1-behaviors.md` — align the v2 stranded-archival parity delta with branch-keyed ownership.

## Prerequisites

- Cleanup discovers materialized v2 worktrees with resolved branch identities and scans completed open-home specs for archival.
