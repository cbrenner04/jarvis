# Mixed refusal commits in-diff edits and stays resumable

## Problem

A repair pass editing both in-diff and out-of-diff paths is refused wholesale, discarding real in-diff repair progress. Depends on 00 and 01.

## Decisions

- On a mixed refusal, revert only out-of-diff paths, then commit the remaining in-diff edits through the normal repair commit path (`commitRepairAndRepublish`) — rules out discarding in-diff progress or committing refused paths.
- Settle retryable (`resumable: true`) with detail naming the reverted paths — progress landed, so resume may converge; rules out applying 01's non-resumable settlement.

## Acceptance criteria

- [ ] A new test drives a repair pass editing one in-diff and one out-of-diff path; the in-diff edit is committed, the out-of-diff path is clean in `git status`, and the run settles `resumable: true` naming the reverted path; it fails against the pre-fix refuse-all behavior.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — completion-failure recovery: mixed refusal commits in-diff edits, reverts out-of-diff paths, stays resumable.
- `v2/docs/v1-behaviors.md` — record the mixed-refusal behavior.
