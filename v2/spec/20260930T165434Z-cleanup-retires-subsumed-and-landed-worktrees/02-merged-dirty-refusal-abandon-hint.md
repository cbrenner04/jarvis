# 02 — Merged-worktree dirty refusal abandon hint

## Problem

`mergedWorktreeRetirementRefusalLine` names dirty paths but not how to retire the lane manually after verification.

## Decision ledger

- Append the same suggested command as `Landed elsewhere`: `run jarvis cleanup --abandon <branch> --discard-unlanded after verifying`; rules out changing when merged worktree removal is refused or which paths count as dirty.

## Work

- Extend `mergedWorktreeRetirementRefusalLine` (and any single caller that must stay in sync) to include the branch name in the suggested `--abandon` command.

## Acceptance criteria

- [ ] `cleanup.test.ts` test `merged plan worktree with landed criteria-only dirt retires safely` (or a sibling assertion in that file) expects the dirty merged-worktree refusal line to name `jarvis cleanup --abandon` with `--discard-unlanded`; fails against the pre-fix baseline.

## Documentation updates

- Deferred to [03-documentation.md](./03-documentation.md).
