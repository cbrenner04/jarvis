---
name: cleanup-archives-in-the-invocation-that-retires
---

# One `jarvis cleanup` invocation both retires the worktree and archives the spec

## Problem

`runCleanupCommand` (`v2/src/commands/cleanup.ts`) computes the stranded/open-home artifact set from
`discovered`, the materialized-worktree list captured before any retirement. A spec whose worktree is
retired later in the same invocation is evaluated while that worktree is still materialized, fails the
"another materialized owner" check, and never reaches `retireStrandedArtifacts`. The operator must run
`jarvis cleanup` a second time — doing no new work — to archive it. `--dry-run` previews from the same
stale snapshot, so it lists candidates the apply pass then refuses.

`v2/docs/operator-runbook.md` § Cleanup claims the opposite ("needs no rerun").

## Decisions

- Re-derive the materialized-worktree list after retirement and evaluate the stranded/open-home artifact set against that post-retirement list within the same invocation; rules out feeding a stale pre-retirement snapshot to the ownership check and rules out the second run.
- Ownership refusal still fires for an owner this invocation did not retire; rules out buying same-invocation archival by weakening the gate.
- Unchecked-criteria and open-matching-PR refusals keep their existing reasons and wording.
- `--dry-run` previews the set the apply pass would archive, accounting for the worktrees it would retire; where that is not knowable without retiring, it says so rather than listing a candidate it would refuse.
- Out of scope: archival eligibility rules, dead-socket reaping.

## Acceptance criteria

- [ ] A single `jarvis cleanup` invocation that retires a worktree archives that spec to `completed/`; a regression test drives retire-plus-archive in one invocation and fails against the pre-fix ordering.
- [ ] An immediate second invocation reports nothing to clean.
- [ ] A spec whose owning worktree is not retired by the invocation is still refused, and the refusal names the materialized owner; inverting that guard fails a test.
- [ ] `cleanup.test.ts` "archives eligible stranded specs without retiring a worktree and retains refused siblings" stays green (unchecked-criteria and open-matching-PR refusals unchanged).
- [ ] `--dry-run` output matches what the apply pass archives for the same state.
- [ ] `v2/docs/operator-runbook.md` § Cleanup states the actual single-invocation guarantee and what `--dry-run` can predict.

## Documentation updates

- `v2/docs/operator-runbook.md` § Cleanup: same-invocation archival guarantee; `--dry-run` prediction limits.

## Prerequisites

- `jarvis cleanup` retires eligible merged-PR worktrees and archives completed specs to `completed/`
- Archival eligibility refuses on unchecked criteria, an open matching PR, and a materialized owner
