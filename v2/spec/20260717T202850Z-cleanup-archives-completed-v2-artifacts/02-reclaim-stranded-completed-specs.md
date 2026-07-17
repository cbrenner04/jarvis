# 02 - Reclaim stranded completed specs

## Problem

Complete v2 specs can remain at their home after their worktree disappeared before cleanup; the current command exits without inspecting them when no worktree is removable.

## Decisions

- Scan each registered project's configured v2 spec home even when the invocation retires no worktree; rules out requiring historical workspace evidence.
- Inspect only immediate open spec trees and exclude `completed/`, `seeds/`, and `ready-intents/`; rules out recursive re-archival or treating queues as specs.
- Apply the shared completeness, PR, ownership, intent-proof, and transaction policy to stranded candidates; rules out a weaker root-scan safety path.
- Include stranded archive candidates and refusal reasons in dry-run output; rules out discovery that becomes visible only after confirmation.

## Acceptance criteria

- [ ] `jarvis cleanup` archives a complete, unowned v2 spec with no open matching PR even when no worktree is discovered or removed in that invocation.
- [ ] Incomplete specs, specs with an open matching PR, and specs owned by any materialized worktree remain in place with a specific stdout skip reason.
- [ ] The stranded scan ignores completed artifacts and open-work queues, is idempotent, and leaves durable run rows untouched.
- [ ] `jarvis cleanup --dry-run` lists stranded archive candidates and refusal reasons without moving specs or pruning intents.
- [ ] `v2/src/commands/cleanup.test.ts` adds baseline-failing coverage for a no-worktree invocation that archives one eligible stranded spec while retaining incomplete, open-PR, and owned siblings.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — document stranded-spec scanning, exclusions, and refusal reasons.
- `v2/docs/first-workflow-walkthrough.md` — describe session-end retirement of worktree, local branch, completed spec, and proven consumed intent while retaining run history.
- `v2/docs/v1-behaviors.md` — record the no-worktree archival behavior and sources.
