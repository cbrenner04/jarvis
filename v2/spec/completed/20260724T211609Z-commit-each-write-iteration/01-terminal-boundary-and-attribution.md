# 01 - Preserve terminal completion boundary and multi-commit attribution

## Problem

Terminal completion still must fail closed on dirty no-op commits, produce a distinct
completion SHA when iteration commits already sit at `HEAD`, and PR body refresh must
attribute every qualifying subspec commit on multi-SHA branches. Operator docs still
conflate same-branch kill recovery with implement re-run reset.

## Decisions

- Terminal `complete` keeps today's sequence: SQLite boundary, then
  `createCompletionCommitter` with `resolveAndPersistCreationTitle`, then publication —
  rules out dropping the terminal completion commit when iteration commits exist.
- When the worktree is clean and `HEAD` already has `Jarvis-Agent:` from the last iteration
  commit, terminal `complete` still obtains a **new** completion SHA (terminal committer
  input bypasses the iteration HEAD-reuse short-circuit in `completion-commit.ts`) so
  publish-resume and attribution have a distinct completion boundary commit — rules out
  reusing the last iteration SHA as the only completion record.
- When the terminal committer returns no `commitSha` and `git status --porcelain` is
  non-empty, outcome remains `completion_commit_failed` with path listing — rules out
  treating iteration commits as satisfying a dirty terminal boundary.
- Post-loop coverage advisory (implement `patch.prompt.body` `complete` only) may edit the
  worktree after iteration commits; those edits are captured only at terminal completion,
  so a dirty terminal boundary with a no-op committer remains possible and honest in docs.
- Iteration commits use the same committer message shape (`Spec:` body line) so
  `readBranchCommits` / `getSubspecCommits` include them.
- PR narrative marker preservation in `pr-body-refresh.ts` stays unchanged; footer
  attribution lists all qualifying commits on the branch — rules out re-deriving footer
  from a single HEAD commit.
- Operator runbook: **same branch** — committed iteration SHAs survive kill, daemon
  reconcile, and resume while the branch exists; in-flight edits before that iteration's
  commit may still be lost. **Implement re-run reset** — `resetStaleWorkspace` still drops
  the branch and unpushed commits; publication-at-completion-only unchanged.

## Tasks

- Implement terminal committer bypass for clean HEAD-after-iteration (distinct completion SHA).
- Add or extend tests for multi-commit `renderAttribution` under the terminal SHA policy above.
- Add terminal-completion test: iteration commits present, worktree dirty at `complete`, asserts
  `completion_commit_failed`.
- Supersede single completion-meta-commit narrative in `write-behavior.md`; align runbook,
  `v1-behaviors.md`, and `v2-architecture.md` (or note follow-up) with refined recovery boundaries.

## Acceptance criteria

- [x] A new `write-loop.test.ts` case drives two changed `progress` iterations then `done`
      with a clean worktree and asserts branch history includes two iteration SHAs plus a
      third distinct terminal completion SHA, and `renderAttribution({ cwd: worktree, base })`
      footer bullets cover iteration commits and the completion commit per terminal SHA
      policy; it fails against the pre-fix code.
- [x] A new `write-loop.test.ts` case leaves the worktree dirty after iteration commits at
      terminal `complete` with a no-op terminal committer and asserts
      `completion_commit_failed` naming the dirty paths; inverting the terminal dirty check
      yields `complete` and fails.
- [x] `pr-attribution.test.ts` "lists multiple distinct labels in first-appearance order,
      deduped" stays green.
- [x] `pr-body-refresh.test.ts` "composes header + preserved narrative + footer when markers
      and footer present" stays green.
- [x] `bun run typecheck`, `bun run test:v2`, and `test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — replace single completion-meta-commit story with multi-commit
  iteration + terminal completion contract and footer expectations.
- `v2/docs/operator-runbook.md` — same-branch kill/reconcile vs implement re-run reset; which
  SHAs survive; in-flight step loss before iteration commit.
- `v2/docs/v1-behaviors.md` — v2 `progress` per-iteration WIP commits; v1 push-per-iteration vs
  v2 publish-at-completion-only; v1 iteration-timeout checkpoint not ported in this spec.
