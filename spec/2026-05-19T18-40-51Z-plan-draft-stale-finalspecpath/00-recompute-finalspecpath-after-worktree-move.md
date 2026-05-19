# 00 - Recompute finalSpecPath after plan worktree move

## Problem

`jarvis plan` fails in the draft phase for `modes.plan.commit: true` runs
with:

```
plan: draft phase error: ENOENT: no such file or directory, open
  '<projectRoot>/.worktree/plan-tmp-<id>/spec/<timestamp>-<plan-name>/intent.md'
```

In `src/commands/plan.ts`, after the refine phase succeeds, the code:

1. Reads the temporary `intent.md` from
   `<projectRoot>/.worktree/plan-tmp-<id>/spec/tmp-<id>/intent.md`.
2. Derives the final plan name and `specDirBasename`.
3. Renames `spec/tmp-<id>` to `spec/<specDirBasename>` inside the temporary
   worktree.
4. For `commit: true`, sets:

   ```ts
   finalSpecPath = join(worktreePath, "spec", specDirBasename);
   ```

   at a point when `worktreePath` still points at `.worktree/plan-tmp-<id>/`.

5. For `commit: true`, runs `git worktree move` to relocate the worktree to
   `.worktree/plan-<planName>/` and reassigns `worktreePath` to that new path.
6. Calls `runDraftPhase`, which (for `commit: true`) reads `intent.md` via
   `join(finalSpecPath, "intent.md")` and fails because `finalSpecPath` still
   points at the now-deleted `plan-tmp-<id>` location.

The same stale path is later used inside the draft phase, the review-pass
loop, and the boundary-violation paths (`appendBoundaryBlocker`,
`countSpecFiles`, `snapshotSpecDirFiles`, etc.).

## Scope and decisions

- Fix lives entirely in `src/commands/plan.ts`. No changes to
  `src/modes/plan/*.ts` or to prompts.
- Recompute `finalSpecPath` after the `git worktree move` for `commit: true`
  so it always reflects the post-move worktree path. The simplest and least
  invasive change is to reassign `finalSpecPath` immediately after the
  `worktreePath = nextWorktreePath` reassignment in the existing
  `commit !== false` branch (and to keep the existing pre-move assignment so
  any code that runs before the move continues to read from the correct
  temporary location).
- `commit: false` behavior is unchanged. In that branch `finalSpecPath`
  points at `~/.jarvis/specs/<projectId>/<specDirBasename>/`, which is set
  via `renameSync` of the spec directory out of the temporary worktree and
  is not affected by any subsequent worktree move (there is no worktree move
  in the `commit: false` flow).
- No changes to commit messages, branch names, PR composition, or
  attribution.
- No changes to public-facing CLI output other than the absence of the
  spurious ENOENT error.
- Do not introduce a new helper or refactor the surrounding code. The
  authorized change is the minimal recomputation needed to fix the
  regression.

## Task Checklist

- [ ] In `src/commands/plan.ts`, inside the `commit !== false` branch that
  runs `git worktree move` and reassigns `worktreePath = nextWorktreePath`,
  also reassign `finalSpecPath = join(worktreePath, "spec", specDirBasename)`
  so all subsequent reads (draft phase, review passes, boundary handling,
  blocker handling) use the new worktree path.
- [ ] Add a focused unit/integration test (or extend an existing plan-mode
  test) that simulates a commit-true plan run where the temporary plan
  worktree is moved before the draft phase and asserts that the draft phase
  reads `intent.md` from the post-move worktree path. The test must fail
  against the current implementation and pass with the fix.
- [ ] Confirm no test or call site that relies on the pre-move
  `finalSpecPath` value is broken by the reassignment. The pre-move value is
  used between the rename and the `git worktree move`; the reassignment must
  happen after the move, not before.

## Acceptance criteria

- [ ] `jarvis plan <intent-file>` against a config with
  `modes.plan.commit: true` no longer errors with
  `plan: draft phase error: ENOENT ... plan-tmp-<id>/spec/<basename>/intent.md`
  when the draft phase runs after a successful refine and worktree move.
- [ ] After the fix, every read or write that uses `finalSpecPath` in the
  draft phase, review-pass loop, draft/review boundary handlers, and blocker
  commit handlers resolves to the post-move worktree path for `commit: true`.
- [ ] `commit: false` runs continue to use the Jarvis-owned storage root
  (`~/.jarvis/specs/<projectId>/<specDirBasename>/`) for `finalSpecPath` with
  no change in behavior.
- [ ] A new or extended test reproduces the regression against the
  pre-fix code and passes against the fixed code.
- [ ] `bun run typecheck` passes.
- [ ] `bun test` passes.
- [ ] `bun run check` passes.

## Documentation updates

- No user-facing documentation changes are required. This is an internal
  regression fix; the documented plan-mode behavior already matches the
  intended post-fix behavior.
- If a `CHANGELOG.md` or similar exists at implementation time, add a one
  line entry under bug fixes referencing this spec. (None exists today, so
  this is conditional.)
