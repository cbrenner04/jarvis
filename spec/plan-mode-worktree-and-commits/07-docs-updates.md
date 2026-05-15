# 07 — Documentation updates

## Problem

Document the worktree slot, branch naming, placeholder commit shape,
draft-PR template, and cleanup behavior added by this spec. Bulk
plan-mode docs (the eventual `docs/plan-mode.md`) still wait for the
behavior specs; this subspec only covers what this spec actually
shipped.

## Decisions

- **`README.md`:** add `jarvis plan ...` to the `## Commands` block
  (currently missing — the skeleton's docs subspec intended to add it
  but the line did not survive into `main` after the
  `cli-modes-and-config-v2` rewrite of the same block). The line
  should describe the behavior this spec actually ships: produces a
  draft PR with a placeholder spec tree under `spec/<name>/` from a
  file or inline intent. Keep the description brief and call out that
  real planning content is in flight (forward reference to the
  in-flight `spec/plan-mode-*` specs is fine; do not link to
  `docs/plan-mode.md` until that file exists).
- **`docs/run-loop.md`:** add (or update, if present) a short
  `## Plan mode` subsection describing what plan mode actually does
  today (worktree + branch + placeholder spec + draft PR), with a
  forward reference to `docs/plan-mode.md` for full detail "once it
  lands." Do not link to that file yet.
- **`docs/worktrees-and-commits.md`:**
  - Add a `## Plan-mode worktrees` section documenting:
    - The `.worktree/plan-<name>/` slot and `plan/<name>` branch.
    - Why the `plan-` prefix exists (collision avoidance with patch).
    - Phase commit subjects (`plan: interview`, `plan: draft`,
      and a forward note that `plan: review N` is added by a later
      spec).
    - Push cadence (push after each commit, first push uses `-u`).
    - That plan mode never marks PRs ready.
  - Update the `## Cleanup` section to mention plan worktrees and the
    `(plan)` dry-run tag.
- **`docs/spec-guidance.md`:** no change beyond the sentence already
  added in the skeleton spec's docs subspec; behavior described here
  doesn't need new spec-author guidance.
- **`docs/config.md`:** no change in this spec; `modes.plan.agentOrder`
  documentation already landed in `spec/cli-modes-and-config-v2/`.

## Tasks

- [ ] Update `README.md` `## Commands` block to include `jarvis plan
  ...` with the description above.
- [ ] Add (or update, if present) `## Plan mode` in
  `docs/run-loop.md`.
- [ ] Add `## Plan-mode worktrees` to `docs/worktrees-and-commits.md`
  and extend the existing `## Cleanup` section (line 179) to mention
  plan worktrees and the `(plan)` dry-run / output tag.

## Acceptance criteria

- [x] `README.md` describes the current plan-mode behavior accurately
  (placeholder spec + draft PR), including the "real content in
  flight" note.
- [x] `docs/run-loop.md` plan-mode subsection reflects what landed in
  this spec.
- [x] `docs/worktrees-and-commits.md` documents plan worktrees, their
  branch-naming convention, phase commits, and cleanup behavior.
- [x] `bun run check` passes.

## Documentation updates

- This subspec is the documentation update for
  `spec/plan-mode-worktree-and-commits/`.
