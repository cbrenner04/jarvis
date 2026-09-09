# 03 - Scope detached ownership to identified artifacts

## Problem

A same-project managed worktree with detached or unresolved `HEAD` currently blocks stranded and post-retirement archival repo-wide because `hasBranchKeyedArtifactOwner` treats `branch === undefined` as owning every branch-keyed spec (reachable via `hasBranchKeyedArtifactOwner` guard-inversion test).

## Decision ledger

- Narrow `hasBranchKeyedArtifactOwner` so detached or unresolved managed worktrees block only when `recordedStrandedBranch` / `sourceForRun` identity matches the artifact's `source`; rules out blanket `branch === undefined` owning every branch-keyed spec.
- Same-project branch-keyed ownership continues to refuse when the worktree's resolved branch matches the artifact's recorded implementation branch; rules out reverting to file-presence ownership for external plans.
- Post-retirement in-repo archival keeps `hasInRepoArtifactOwner` (file presence under another worktree); this slice does not change in-repo blocking predicates; rules out introducing a third "materially contains" rule for in-repo specs.
- Primary checkout worktrees remain non-owners; rules out expanding ownership beyond managed worktrees under `~/.jarvis/worktrees/`.

## Work

- Narrow `hasBranchKeyedArtifactOwner` (and stranded / post-retirement external-plan callers) using `recordedStrandedBranch` / `sourceForRun` identity instead of blanket detached matching.
- Leave `hasInRepoArtifactOwner` unchanged for in-repo post-retirement archival.
- Add regression coverage: detached owner preserves its spec while an unrelated completed spec archives.

## Acceptance criteria

- [x] `v2/src/commands/cleanup.test.ts` test `detached owner blocks only its own artifact` stages an unrelated completed spec for archival while preserving the owned spec; it fails against the pre-fix repo-wide ownership gate.
- [x] `v2/docs/operator-runbook.md` documents spec-scoped detached and unresolved worktree ownership for stranded and post-retirement archival.
- [x] `v2/docs/v1-behaviors.md` records the spec-scoped detached-ownership delta.

## Documentation updates

- `v2/docs/operator-runbook.md` — spec-scoped ownership for detached and unresolved managed worktrees.
- `v2/docs/v1-behaviors.md` — detached owners block only identified artifacts.
