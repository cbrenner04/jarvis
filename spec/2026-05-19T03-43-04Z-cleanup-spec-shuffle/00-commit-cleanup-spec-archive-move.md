# 00 - Commit cleanup spec archive move

`jarvis cleanup` already removes merged worktrees and, when a matching
repo-local spec directory exists, renames it from `spec/<archive>/` to
`spec/completed/<archive>/`. The missing piece is that this archive move is left
as an uncommitted working-tree change in the main checkout.

Keep this change narrow: after cleanup successfully moves a spec directory,
commit exactly that move. Do not redesign how cleanup resolves the spec source.
Do not add timestamped plan-spec lookup or ambiguity handling in this slice.

The implementation should use the concrete paths from the successful rename as
the source and destination for staging. That lets cleanup commit the exact spec
that was moved to `completed` without staging unrelated files in the repo.

## Task checklist

- [ ] After a successful spec archive rename, stage only the moved source and
      destination paths needed to record that rename.
- [ ] Create a cleanup-owned git commit in the project root for the archived
      spec move.
- [ ] Do not create a commit when no spec directory was moved, the run is
      cancelled, `--dry-run` is used, removal fails, the archive destination
      already exists, or the rename itself fails.
- [ ] Preserve the existing cleanup gates and archive behavior: merged PR only,
      clean/pushed worktree only, worktree and branch removal before archive,
      missing source remains non-fatal, and archive failures are accumulated
      across the queue.
- [ ] Keep staging scoped so unrelated modified or untracked files in the main
      checkout are not included in the cleanup commit.
- [ ] Add regression coverage in `test/cleanup-command.test.ts` for committing
      the archive move and for leaving unrelated main-checkout changes
      unstaged/uncommitted.

## Acceptance criteria

- [x] When `jarvis cleanup` successfully moves `spec/<archive>/` to
      `spec/completed/<archive>/`, the project repository receives a commit that
      records that exact move.
- [x] The cleanup commit contains only the archived spec path change; unrelated
      modified or untracked files in the main checkout are not staged or
      committed.
- [x] Cleanup does not create a spec-archive commit for dry runs, cancelled
      runs, missing source specs, destination collisions, failed removals, or
      failed archive renames.
- [x] Existing cleanup removal/archive behavior is otherwise unchanged.
- [x] `test/cleanup-command.test.ts` covers the cleanup-owned archive commit and
      the scoped-staging behavior.
- [x] `bun run typecheck` passes.
- [x] `bun test` passes.

## Documentation updates

- [ ] Update cleanup documentation to say that successful in-repo spec archive
      moves are committed automatically and that the commit is scoped to the
      moved spec paths.
