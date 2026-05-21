# Document the pre-ready auto-commit in docs and AGENTS.md

## Context

Subspec `00-implementation.md` introduces a new harness-owned commit
(`chore: apply pre-ready check:fix`) that runs immediately before `gh pr ready`.
Four documentation files need updating so operators and contributors understand:

1. That the commit exists and is not a subspec commit.
2. That `tryFinishSpecIfDone`'s exit-6 path is no longer expected on the normal
   readiness path.
3. How the commit is attributed (excluded from per-commit list; `Jarvis-Agent:`
   trailer still counts toward the summary line).

This subspec depends on `00-implementation.md` being merged first — it references
stable, already-implemented behavior.

## Files to update

### `docs/worktrees-and-commits.md`

In the section covering the draft→ready lifecycle or PR readiness (wherever
`gh pr ready` is described), add a note that the harness may create a single
`chore: apply pre-ready check:fix` commit immediately before `gh pr ready` if
`bun run ready`'s `check:fix` step mutates any files. Clarify that:

- This commit is **not** a subspec commit (no `Spec:` body line).
- It is pushed to the branch automatically before `gh pr ready`.
- Operators do not need to commit or stash anything to allow the readiness
  transition to proceed.

### `docs/workflows.md`

In the patch-mode readiness flow (and any plan-mode equivalent that calls
`maybeMarkReady`), update the diagram or prose to reflect the new step order:

```
… → bun run ready → [commit check:fix diff if dirty] → push → gh pr ready
```

The bracketed step is conditional: it only runs when `bun run ready` produces
file mutations.

### `docs/run-loop.md`

In the section covering `tryFinishSpecIfDone` and the "worktree not clean" exit-6
path, add a clarification:

> After a successful readiness transition, the worktree is guaranteed clean
> because the harness commits any `check:fix` mutations before calling
> `gh pr ready`. Exit 6 on the "worktree not clean" path is therefore reserved
> for genuinely unexpected dirty state (forgotten staged files, untracked
> artifacts) that is unrelated to the `check:fix` step.

### `AGENTS.md`

In the "PR attribution" section (around line 63), add a note explaining that
the `chore: apply pre-ready check:fix` commit is intentionally excluded from the
per-commit attribution list because it has no `Spec:` body line. Its
`Jarvis-Agent:` trailer still counts toward the agent summary line. Example
wording:

> The harness may emit a single `chore: apply pre-ready check:fix` commit
> immediately before marking the PR ready. This commit has no `Spec:` trailer
> and is excluded from the per-commit attribution list. Its `Jarvis-Agent:`
> trailer is still included in the summary attribution line.

## Tasks

- [ ] Update `docs/worktrees-and-commits.md` to describe the conditional
      `chore: apply pre-ready check:fix` commit in the readiness lifecycle.
- [ ] Update `docs/workflows.md` to show the new "commit check:fix diff if dirty"
      step in the patch-mode (and any plan-mode) readiness flow.
- [ ] Update `docs/run-loop.md` to clarify that exit 6 is reserved for
      unexpected dirty state and is not expected on the normal readiness path.
- [ ] Update `AGENTS.md` to document the attribution behavior of the
      `chore: apply pre-ready check:fix` commit.

## Acceptance criteria

- [ ] `docs/worktrees-and-commits.md` mentions the `chore: apply pre-ready check:fix`
      commit, identifies it as a conditional harness commit (not a subspec commit),
      and states that operators do not need to manually commit anything for the
      readiness transition.
- [ ] `docs/workflows.md` reflects the updated readiness sequence including the
      conditional commit step before `gh pr ready`.
- [ ] `docs/run-loop.md` clarifies that the "worktree not clean" exit 6 from
      `tryFinishSpecIfDone` is not expected on the normal readiness path after this
      change.
- [ ] `AGENTS.md` documents that the `chore: apply pre-ready check:fix` commit is
      excluded from the per-commit attribution list but its `Jarvis-Agent:` trailer
      counts toward the summary line.
- [ ] `bun run typecheck` passes (docs changes are prose only; this is a
      sanity-check that no TypeScript files were accidentally modified).
