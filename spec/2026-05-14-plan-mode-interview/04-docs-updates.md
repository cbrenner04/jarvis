# 04 — Documentation updates

## Problem

Plan mode now supports the interview phase, interactive mode, and
agent-proposed naming. Update the docs added in
`spec/2026-05-14-plan-mode-draft-and-review/04-docs-updates.md` and the README to
reflect the new behavior.

## Decisions

- **`docs/plan-mode.md`:**
  - Update the "Phases" section: interview is no longer
    forward-referenced; document it fully (per-turn agent invocation,
    `## Interview turn N` persistence, validation, blocker handling,
    early stop, budget).
  - Update the "Input modes" section: interactive mode is now
    implemented; document the empty-seed behavior and the
    `--interview-turns 0` rejection.
  - Add a "Naming" section: agent-proposed kebab-case name in
    `intent.md` frontmatter, deterministic fallback, uniqueness
    suffix loop, two-stage worktree rename.
  - Update the "Flags" section: remove the "(parsed but inert)" note
    on `--interview-turns`; keep the note on `--resume`.
- **`README.md`:** update the plan-mode paragraph to mention
  interactive mode (`jarvis plan` with no args drops into an
  interview) and remove any "in flight" caveat for interview/naming.
- **`docs/run-loop.md`:** update the plan-mode subsection's brief
  description to reflect the full phase order (interview → draft →
  self-review → pause).
- **`docs/spec-guidance.md`:** the "Authoring with `jarvis plan`"
  subsection added in the previous spec gains a sentence noting that
  plan mode also handles interactive sessions for fuzzy intents.
- **`docs/AGENTS.md`:** add a sentence under "Plan-mode prompts"
  noting that interview prompts use the structured `question` tool
  exposed by jarvis to gather user input.
- **`docs/config.md`:** no schema change. No update required.
- **`docs/worktrees-and-commits.md`:** add a brief note in the
  "Plan-mode worktrees" section about the temporary
  `plan-tmp-<short-uuid>/` slot used during the interview phase and
  the rename to `plan-<name>/` once the name is decided. Note that
  the temp branch is never pushed.

## Tasks

- [ ] Update `docs/plan-mode.md` per the bullet list above.
- [ ] Update `README.md` plan-mode paragraph.
- [ ] Update `docs/run-loop.md` plan-mode subsection.
- [ ] Append the interactive-sessions sentence to the "Authoring
  with `jarvis plan`" subsection in `docs/spec-guidance.md`.
- [ ] Update `docs/AGENTS.md` "Plan-mode prompts" section.
- [ ] Update `docs/worktrees-and-commits.md` plan-mode worktrees
  section with the temp-slot note.

## Acceptance criteria

- [ ] `docs/plan-mode.md` documents interview, interactive mode, and
  agent-proposed naming with no forward references to unimplemented
  behavior beyond resume.
- [ ] `README.md` mentions interactive mode and removes the
  "in flight" caveats for interview and naming.
- [ ] `docs/worktrees-and-commits.md` documents the temp-slot
  rename.
- [ ] `bun run check` passes.

## Documentation updates

- This subspec is the documentation update for
  `spec/2026-05-14-plan-mode-interview/`.
