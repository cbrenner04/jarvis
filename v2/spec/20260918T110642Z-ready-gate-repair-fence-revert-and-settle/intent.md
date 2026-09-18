---
name: ready-gate-repair-fence-revert-and-settle
---

# Ready-gate repair fence reverts refused out-of-diff edits and settles non-resumable

## Prerequisites

## Behavior

When completion staging refuses ready-gate repair edits outside the run diff and spec tree (`v2/src/execution/write-loop.ts`), the fence stays absolute, but the refused paths are reverted in the worktree so a terminal run leaves a clean tree that `jarvis cleanup` can reclaim: modified tracked paths are restored to their pre-repair content and newly-created untracked paths are deleted. The refusal detail names the refused paths and states they were reverted. A refusal whose repair edits were entirely out-of-diff settles the run non-resumable with an incident naming the refused paths (no `resume` advertised, closing the #3040 retryable-forever wedge); the out-of-diff fix becomes an operator decision. A mixed refusal (some edits in-diff, some out-of-diff) commits the in-diff edits, reverts only the out-of-diff paths, and leaves the run resumable, since real repair progress landed.

## Acceptance criteria

- [ ] A repair pass editing a path outside run diff and spec tree ends with that path clean (`git status` empty for it) — a modified tracked path restored, a newly-created path deleted — and the failure detail recording the revert, pinned by a test failing against current leave-dirty behavior.
- [ ] In-diff repair edits still stage and commit normally, pinned by an existing or new test.
- [ ] An entirely out-of-diff refusal settles non-resumable with an incident naming the refused paths, pinned by a test.
- [ ] A mixed in-diff/out-of-diff refusal commits the in-diff edits, reverts the out-of-diff paths, and leaves the run resumable, pinned by a test.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — completion-failure recovery entry: refused out-of-diff repair edits are reverted; an entirely out-of-diff refusal settles non-resumable; a mixed refusal commits in-diff edits and stays resumable.
- `v2/docs/v1-behaviors.md` — record.
