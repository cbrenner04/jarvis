# Cleanup's stranded-artifact owner check matches any worktree containing the spec file

## Problem

`jarvis cleanup` refuses to archive a completed, merged open-home spec whenever **any**
`~/.jarvis/worktrees/` worktree happens to contain the spec's file path — even a worktree
that has nothing to do with that spec. The owner check in `inspectStrandedArtifacts`
(`v2/src/commands/cleanup.ts:323-325`) is:

```ts
const hasOwner = allWorktrees.some((worktree) =>
  existsSync(join(worktree.path, relative(projectRoot, artifact.source))),
);
```

`artifact.source` is the spec dir under `v2/spec/`. Any worktree checked out on a branch that
carries that path (e.g. **any worktree on `main` after the spec merged**) makes `existsSync`
true, so `hasOwner` is true and cleanup skips with "another materialized worktree owns this
spec". Observed 2026-07-20: a single unrelated report-drafting worktree on `main` blocked
archival of **all 8** completed specs in the home at once; removing it made all 8 eligible.

The retired-worktree path (`dispatchRetiredArtifact`, ~line 272) already excludes the
candidate's own path; the stranded path has no equivalent guard and — worse — keys on file
presence rather than the worktree's branch.

## Decisions

- The stranded-artifact owner check identifies a materialized owner by the worktree's **branch
  matching the spec's branch** (an actual materialized implement worktree for that spec), not by
  file presence at the spec path; rules out any `main`-based or unrelated worktree counting as an
  owner.
- A worktree merely containing the spec file because it is checked out on a ref that includes the
  merged spec is **not** an owner.

## Acceptance criteria

- [ ] With a completed, merged open-home spec and an unrelated `~/.jarvis/worktrees/` worktree
      checked out on `main` (or any ref containing the spec), `jarvis cleanup` archives the spec
      (the unrelated worktree is not treated as its owner).
- [ ] A genuine materialized worktree whose branch is the spec's branch still blocks archival.
- [ ] `bun run typecheck`, `test:v2`, and `test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — remove/adjust the note that any lingering worktree blocks
  stranded-artifact archival once the branch-keyed check ships.
