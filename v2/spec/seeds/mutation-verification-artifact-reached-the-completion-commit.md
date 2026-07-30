---
name: mutation-verification-artifact-reached-the-completion-commit
---

# A mutation-verification artifact reached the completion commit

## Problem

An implement run committed, pushed, flipped its PR to ready, and reported `completed` while its
completion commit carried an inverted guard left behind by mutation verification. Every local
gate signal was green; CI caught it only because 26 v1 plan tests failed.

Observed 2026-07-30 on `20260730T052654Z-plan-split-preserves-draft-scope` (PR #2314, closed
unmerged). `shared/module-boundary-surfaces.ts` shipped
`function sectionBounds(...) { const start = lines.indexOf(heading); if (start !== -1) return null; ... }`
— the mutation of `start === -1`. The worktree working copy held the correct source while `HEAD`
held the mutation, so the run's own gate and a hand `bun test` both passed. Recovery was abandon
plus a fresh implement run.

This is the inverse of `surviving_mutation_failed`: the harness proved coverage kills the mutation
and then shipped the mutation.

## Decisions

- After mutation verification, restoration is verified against the tree that will be committed:
  the run compares each mutated path's post-restore content to its pre-mutation content and
  refuses to commit on mismatch — rules out trusting the restore write, and rules out comparing
  only in memory.
- The check runs on the staged/committed content, not the working copy, so a mutation present in
  `HEAD` but absent from the working tree is still caught — rules out a working-copy-only
  comparison, which is exactly what passed here.
- A mismatch settles a named non-retryable failure identifying every path whose restore failed and
  leaves the worktree intact for inspection — rules out silently re-restoring and continuing.
- Restoration keeps using saved pre-mutation content, never `git checkout -- <path>` — rules out
  discarding the run's own uncommitted work (see the operator runbook's 2026-07-26 entry).

## Acceptance criteria

- [ ] A pre-fix-failing regression makes restoration corrupt one mutated file, then asserts the run
      settles the named restore-mismatch failure, performs no completion commit, no push, and no
      draft-to-ready flip, and names the corrupted path.
- [ ] The same regression proves detection when the mutation is present in the committed content
      but absent from the working copy.
- [ ] A clean mutation-verification pass still commits, publishes, and reports `completed` with no
      new failure; existing mutation-verification regressions stay green.
- [ ] Inverting the restore-comparison guard turns the restore-mismatch regression RED.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Gate trust — a `completed` implement row implies mutated sources
  were verifiably restored in the committed tree.
- `v2/docs/write-behavior.md` — restore verification at the mutation-verification boundary.
