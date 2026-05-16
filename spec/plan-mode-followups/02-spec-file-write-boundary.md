# 02 — Spec-file write boundary enforcement

## Problem

The plan-mode prompts instruct the agent to "only write files under
`spec/<NAME>/`," but nothing in the harness enforces that boundary. If
a buggy or malicious agent writes outside that directory (e.g.
`src/...` or `.github/...`), the harness will happily commit and push
those changes to the draft PR. Review notes flagged this as items
**#11**, **#12**, and partially **#14** (the latter overlaps with
sandbox/permissions, which is out of scope for this spec).

## Decisions

- **Diff-based boundary check before each plan commit.** After the
  agent returns and before `commitPlanDraft`, `commitPlanReview`, or
  `commitPlanBlocker` runs, the harness shells out to
  `git status --porcelain=v1 -z` in the worktree, parses the result,
  and verifies that **every** modified, added, or deleted path is one
  of:
  - inside `spec/<name>/`, or
  - the worktree's own `.gitignore` line that jarvis manages (if any —
    today there is none, but the check should be tolerant of an empty
    allowlist), or
  - exactly `spec/<name>/intent.md` for the blocker case (this is
    already inside `spec/<name>/`, so this bullet is informational).
- **Out-of-bounds writes are a blocker, not a crash.** When the check
  fails, the harness:
  1. Resets the offending paths with `git checkout -- <path>` (does
     not delete files; just reverts working-tree changes).
  2. Appends a `## Blocker` section to `intent.md` describing exactly
     which paths were touched and that they were reverted.
  3. Commits whatever remains as `plan: blocker` and exits `1`.
- **No sandboxing.** This spec does not change the agent's
  filesystem permissions; it only enforces the boundary
  retroactively. A separate spec can introduce sandboxing later.
- **Symlink edge case.** If a path resolves outside `spec/<name>/`
  via a symlink, the check treats it as out-of-bounds. The
  reversion uses `git checkout --` on the path as reported by
  `git status`, which operates on the index entry, not the resolved
  target.

## Acceptance criteria

- [ ] A new helper `assertPlanWriteBoundary(worktreePath, name)` in
  `src/modes/plan/boundary.ts` returns `{ ok: true }` or
  `{ ok: false, offendingPaths: string[] }`.
- [ ] `planCommand` in `src/commands/plan.ts` calls the helper before
  every plan-mode commit (draft, review, and blocker).
- [ ] On a boundary violation, jarvis reverts the offending paths,
  writes the blocker section, lands a `plan: blocker` commit, and
  exits `1`. The stderr message names the offending paths.
- [ ] Tests in `test/modes/plan/boundary.test.ts` cover: clean tree,
  in-bounds writes only, single out-of-bounds write, mixed
  in-bounds/out-of-bounds, deletion of an out-of-bounds tracked file,
  symlink-traversal attempt.
- [ ] `bun run typecheck`, `bun test`, and `bun run check` all pass.

## Documentation updates

- Add a "Write boundary" subsection to `docs/plan-mode.md` describing
  the rule, the revert behavior, and the resulting exit code.
- No changes to `README.md` or `AGENTS.md`.
