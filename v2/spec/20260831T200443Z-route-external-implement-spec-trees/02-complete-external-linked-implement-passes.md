# Complete external linked implement passes

After an external linked write loop completes, `runLinkedImplementStep` re-reads the pinned subspec and advances the index checkbox on the worktree copy of `index.md`, so external criteria edits and harness index ticks never land on the admitted tree.

## Decisions

- Re-read the pinned linked subspec from the external absolute path after the write loop; rules out re-resolving through the worktree copy.
- Write index checkbox advancement and routing-mutation restoration to the external `index.md` at `step.specPath`; rules out ticking a worktree shadow index.
- Keep the existing pinned-index re-resolve contract (no fresh selection after the write loop); rules out reintroducing criteria walk-past bugs from `20260805T123412Z-criteria-based-subspec-routing`.
- Leave in-repo linked completion semantics unchanged when `externalPlanSpec` is absent; rules out altering worktree-only index advancement for ordinary specs.
- Preserve sibling routing safeguards (`implement.index_routing_mutated`, criteria-incomplete `contract_miss`, malformed/missing link ordering); rules out weakening index-mutation detection for external indexes.

## Tasks

- In `runLinkedImplementStep`, point `beforeIndexContent`, `finalizeLinkedImplementPass`, and pinned re-read paths at the external index for `externalPlanSpec` runs.
- Add a multi-link external fixture regression: complete the first linked subspec, assert its external index box advances, the second subspec becomes active, and the worktree contains no copied spec tree.
- Ensure `completeLinkedSubspec` still compares agent criteria against the pinned external body.

## Acceptance criteria

- [ ] `v2/src/execution/workflow-runner.test.ts` regression completes one external linked subspec, ticks its external index checkbox, routes the next criteria-incomplete external link, and leaves the code worktree free of external spec files; it fails against the pre-fix worktree index tick path.
- [ ] `shared/linked-subspec-routing.test.ts` stays green (pinned re-read and `completeLinkedSubspec` contract unchanged for in-repo trees).

## Documentation updates

- None in this subspec; `05` owns operator-facing docs.
