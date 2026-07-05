# 02 - Decision-gated resume: revise

Add the `revise` decision: repeat an earlier step's write loop, consuming one of
that human step's configured revision budget, gated on a dirty worktree or an
injected free-text prompt.

## Prerequisites

- [01 - Decision-gated resume: approve/abort](./01-decision-resume-approve-abort.md) is
  merged: `resume`'s `decision` param exists and `revise` is currently rejected.

## Decisions

- Human step config gains optional `onRevise: { repeatStepId: string; maxRevisions: number }`,
  naming an earlier step in the same authored `steps[]` array and a revision
  budget — an open-ended revise with no bound and no target is out of scope.
- `revise` spawns the named step's write loop again under a synthesized stepId
  (`${repeatStepId}~r<n>`, next unused `n` up to `maxRevisions`) rather than
  reopening the original completed run row — reuses `findRunByProjectBranch`'s
  existing per-`stepId` identity model instead of adding a new `StateStore`
  "reopen completed run" primitive.
- `revise` requires either the repeated step's worktree to be git-dirty or an
  RPC-supplied `prompt` string; neither present rejects `revise_requires_input`.
- A supplied `prompt` is appended to the repeated step's `stepRules` for that
  revision attempt only — operator input is not silently discarded.
- A human step with no `onRevise` configured rejects any `revise` decision
  outright.
- Exhausting `maxRevisions` (all `~r1..~rN` stepIds already used) rejects further
  `revise` decisions with `revise_exhausted`.
- Add `isWorktreeDirty(worktreePath): boolean` (via `git status --porcelain`) —
  no git-dirty check exists yet in `v2/src` or `shared/`.

## Acceptance criteria

- [ ] `revise` on a human step with `onRevise` configured, called against a dirty
      worktree, spawns a write loop under stepId `${repeatStepId}~r1` reusing the
      repeated step's config.
- [ ] `revise` on a clean worktree with no `prompt` param is rejected
      `revise_requires_input`.
- [ ] `revise` on a clean worktree with a `prompt` param succeeds, and the
      spawned revision step's `stepRules` includes the supplied prompt text.
- [ ] A second `revise` after the first's revision run completes spawns stepId
      `${repeatStepId}~r2`; a step configured with `maxRevisions: 1` rejects a
      second `revise` with `revise_exhausted`.
- [ ] `revise` on a human step with no `onRevise` configured is rejected
      regardless of worktree state or prompt.

## Documentation updates

- `v2/docs/workflow-runner.md`: document `onRevise` config and the revision
  stepId scheme.
- `v2/docs/daemon-host.md`: document the `revise` decision's `prompt` param and
  its error codes (`revise_requires_input`, `revise_exhausted`).
