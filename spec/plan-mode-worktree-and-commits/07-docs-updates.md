# 07 — Documentation updates

## Problem

Document the worktree slot, branch naming, placeholder commit shape,
draft-PR template, and cleanup behavior added by this spec. Bulk
plan-mode docs (the eventual `docs/plan-mode.md`) still wait for the
behavior specs; this subspec only covers what this spec actually
shipped.

## Decisions

- **`README.md`:** update the `## Quickstart`-adjacent area or the
  `## Commands` block (whichever is least intrusive) to reflect that
  `jarvis plan <intent-file>` and `jarvis plan "<inline text>"` now
  produce a draft PR with placeholder content. Keep the description
  brief and call out that real planning content is in flight.
- **`docs/run-loop.md`:** update the placeholder plan-mode subsection
  added by `spec/plan-mode-skeleton/06-readme-and-docs-stub.md` so it
  describes what plan mode actually does today (worktree + branch +
  placeholder spec + draft PR), with a forward reference to
  `docs/plan-mode.md` for full detail when it lands.
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
- **`docs/config.md`:** no change in this spec; `planAgentOrder`
  documentation already landed in skeleton subspec 06.

## Tasks

- [ ] Update `README.md`.
- [ ] Update `docs/run-loop.md` plan-mode subsection.
- [ ] Add `## Plan-mode worktrees` to `docs/worktrees-and-commits.md`
  and update the `## Cleanup` section.

## Acceptance criteria

- [ ] `README.md` describes the current plan-mode behavior accurately
  (placeholder spec + draft PR), including the "real content in
  flight" note.
- [ ] `docs/run-loop.md` plan-mode subsection reflects what landed in
  this spec.
- [ ] `docs/worktrees-and-commits.md` documents plan worktrees, their
  branch-naming convention, phase commits, and cleanup behavior.
- [ ] `bun run check` passes.

## Documentation updates

- This subspec is the documentation update for
  `spec/plan-mode-worktree-and-commits/`.
