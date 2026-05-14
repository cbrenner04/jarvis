# 01 — Draft phase (real agent call replaces placeholder)

## Problem

`spec/plan-mode-worktree-and-commits/04-commits-per-phase.md` produces
a `plan: draft` commit with placeholder `index.md` and `00-task.md`
files. This subspec replaces that placeholder with a real agent
invocation that reads `intent.md`, the target repo for context, and
`docs/spec-guidance.md`, then writes the spec tree.

## Decisions

- **Replace, do not duplicate.** The placeholder file-writing logic in
  the previous spec is removed and replaced with the agent invocation.
  The `plan: draft` commit subject and basic shape stay the same; only
  the contents change (and the body line that read "Placeholder
  draft. Real content comes from..." is removed).
- **Updated `plan: draft` commit body:**

  ```text
  Drafted by <agent-attribution>.
  Subspecs: <count>
  ```

  `<agent-attribution>` uses the agent's `attributionLabel()`, the
  same value written into the commit's `Jarvis-Agent` git trailer
  (see `AGENTS.md`'s PR-attribution rules). The harness writes that
  trailer automatically through the shared commit primitive, so the
  body line is purely for human readability when reading `git log` —
  the machine-readable source of truth is the trailer, which the
  PR-body attribution footer renders from. `<count>` is the number
  of files matching `spec/<name>/[0-9]*.md` (i.e. atomic subspecs,
  excluding `index.md` and `intent.md`).
- **Agent prompt** lives at `src/modes/plan/prompts/draft.md` and is
  short. It must:
  - Inject `<NAME>`, the relative spec directory path
    (`spec/<name>/`), and the absolute worktree path.
  - Inline the contents of `intent.md` (read at prompt-build time, not
    referenced by path — agents may not have permission to read
    arbitrary files).
  - Inline `docs/spec-guidance.md` (read at prompt-build time from the
    main checkout, not the worktree).
  - Inline a short rules block (analogous to patch mode's
    `rules.md`) telling the agent: only write files under
    `spec/<name>/`; do not commit; do not push; do not run tests; do
    not modify `intent.md`; produce `index.md` plus at least one
    `NN-task.md` subspec; follow the heading contract in spec
    guidance.
  - End with a single concrete instruction: produce the files now.
- **Single invocation, no inner loop.** The draft phase calls the
  agent once. If the agent exits without producing the required files
  (`index.md` and at least one `NN-*.md`), treat it as a draft
  failure: print the agent's stderr, do not commit, exit `1`. The
  worktree remains for the user to inspect.
- **Agent working directory.** The agent runs with the plan worktree
  as its CWD. This is important because the agent's safe-edits
  permission posture restricts file writes to its CWD.
- **Validation before commit.** After the agent exits, plan mode
  checks:
  - `spec/<name>/index.md` exists.
  - At least one `spec/<name>/NN-*.md` exists where `NN` is two
    digits.
  - `index.md` parses as the spec-guidance shape (H1, optional
    `repo:`, GitHub-style task list linking to subspec files).
  - `intent.md` was not modified.
  Validation failures surface as exit `1` with the specific failure
  named.
- **Quota fallback.** If the chosen agent fails with a quota signal,
  advance to the next agent in `planAgentOrder` (or `agentOrder` when
  unset). If all are exhausted, exit with the existing
  quota-exhausted code from `jarvis run`.
- **PR body live-update.** After the `plan: draft` commit is pushed,
  trigger the same PR-body rewrite path patch mode uses on each
  subspec commit. The deterministic header (from
  `spec/plan-mode-worktree-and-commits/05`) is rebuilt, the
  attribution footer re-renders to include the new commit's
  `Jarvis-Agent` trailer, and the narrative section between the
  markers is preserved verbatim. This subspec does not yet add any
  agent-authored narrative content; the markers simply remain empty
  until the review phase (subspec 02) or a future spec writes
  between them.

## Implementation hints

- Add a `src/modes/plan/` directory mirroring `src/modes/patch/`.
- Reuse the existing agent-spawn helper (the one patch mode uses);
  inject the plan-mode prompt as the message body.
- Prompt assembly is a pure function `buildDraftPrompt({ name,
  intent, specGuidance }): string` — easy to test.

## Tasks

- [ ] Add `src/modes/plan/prompts/draft.md` with the documented
  contents.
- [ ] Add `buildDraftPrompt` helper.
- [ ] Wire the draft phase into `planCommand` in place of the
  placeholder writes.
- [ ] Update the `plan: draft` commit body to the documented shape.
- [ ] Implement post-agent validation.
- [ ] Wire in agent quota fallback through the existing helper.
- [ ] Tests:
  - Stub agent that writes a valid spec tree → `plan: draft` commit
    contains the expected files; commit body shape correct; PR
    creation continues normally.
  - Stub agent that writes nothing → exit `1`, no `plan: draft`
    commit, validation message identifies the missing files.
  - Stub agent that modifies `intent.md` → exit `1`, validation
    message names the violation.
  - First agent reports quota → second agent runs and produces the
    spec; commit attribution reflects the second agent.
  - All agents quota-exhausted → existing exit code/message from
    `jarvis run`.

## Acceptance criteria

- [ ] `plan: draft` commit contents come from the agent, not the
  placeholder.
- [ ] Commit body matches the documented shape with attribution and
  subspec count.
- [ ] Draft validation rejects malformed agent output without
  committing.
- [ ] `intent.md` is never modified by the draft phase (validated).
- [ ] Quota fallback works exactly as patch mode's; quota exhaustion
  exits with the same code/message.
- [ ] `bun run typecheck`, `bun test`, `bun run check` all pass.

## Documentation updates

- None. Subspec 04 covers docs.
