# 04 — Documentation updates

## Problem

Plan mode now does real work for non-interactive invocations: drafts a
spec from intent, runs self-review passes, handles blockers and
quota. This is enough behavior to justify a dedicated `docs/plan-mode.md`
document and a substantial pass over the existing docs that previously
only forward-referenced plan mode.

## Decisions

- **Create `docs/plan-mode.md`** with the following sections:
  - Overview: what plan mode does and how it relates to `jarvis run`.
  - Input modes: file, inline, interactive (note that interactive
    is still in flight; lands in `spec/plan-mode-interview/`).
  - Phases: interview (forward reference; not yet implemented),
    draft, self-review, pause-for-PR. For each implemented phase,
    document the agent prompt's intent (not full text), commit
    subject/body shape, push timing, and validation rules.
  - Flags: `--interview-turns` (parsed but inert pending interview
    spec), `--review-passes` (default 2; 0 skips), `--repo`, `--cwd`,
    `--resume` (parsed but inert).
  - Stop conditions: complete, Ctrl-C, quota, blocker. Document the
    `## Blocker`-in-`intent.md` convention with a small example.
  - PR lifecycle: draft only; jarvis never marks ready; merge-first
    rule for the spec.
  - Cleanup: cross-reference the `(plan)` tag in
    `jarvis cleanup --dry-run` and the `.worktree/plan-<name>/`
    convention.
- **`README.md`:** the only current plan-mode mention is the
  `## Commands` block line "Real planning content is in flight."
  (around line 94). Replace that line with a one-line description of
  what `jarvis plan` produces (a draft PR with a real, agent-drafted
  and self-reviewed spec tree from a file or inline intent), and add
  a short prose paragraph elsewhere in `README.md` linking to
  `docs/plan-mode.md`. Keep the entry inside the `## Commands` code
  block.
- **`docs/run-loop.md`:** the current plan-mode subsection (around
  lines 128-138) describes the worktree, two phase-marker commits,
  and the draft PR, then forward-references `docs/plan-mode.md`. Trim
  the subsection so it only disambiguates run vs. plan and link
  straight to `docs/plan-mode.md` for plan-mode flow.
- **`docs/spec-guidance.md`:** add a short "Authoring with
  `jarvis plan`" subsection noting that plan mode produces specs
  conforming to the same conventions documented in this file, and
  that plan-generated specs follow the same merge-first rule.
- **`docs/AGENTS.md`:** add a short "Plan-mode prompts" note pointing
  at `src/modes/plan/prompts/` and explaining that plan mode uses the
  same agent contract as patch mode (no new agents, no permission
  posture changes).
- **`docs/config.md`:** no schema changes in this spec; existing
  `modes.plan.agentOrder` documentation already covers what changed.

## Tasks

- [ ] Create `docs/plan-mode.md` with the sections above.
- [ ] Update `README.md` to replace the "in flight" stub with a real
  description and link.
- [ ] Update `docs/run-loop.md` plan-mode subsection.
- [ ] Add the "Authoring with `jarvis plan`" subsection to
  `docs/spec-guidance.md`.
- [ ] Add the "Plan-mode prompts" note to `docs/AGENTS.md`.

## Acceptance criteria

- [x] `docs/plan-mode.md` exists and covers overview, input modes,
  phases, flags, stop conditions, PR lifecycle, and cleanup.
- [x] `README.md` no longer carries the "in flight" stub for
  non-interactive plan mode and links to `docs/plan-mode.md`.
- [x] `docs/run-loop.md` and `docs/spec-guidance.md` reflect what plan
  mode currently does.
- [x] `bun run check` passes.

## Documentation updates

- This subspec is the documentation update for
  `spec/plan-mode-draft-and-review/`.
