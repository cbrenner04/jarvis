# 01 — Run-start spec tracking check

## Problem

Even with the commit-spec-first flow documented (subspec 00), it is easy to
forget. The failure mode is silent: `jarvis run` happily proceeds, copies
the untracked spec into the worktree, and the spec ends up in the
implementation PR's diff.

`jarvis run` should detect this case at startup and ask the user to confirm
before proceeding.

## Decisions

- The check runs **after** spec-path validation (the file must exist) and
  **after** project resolution (so we know the project root), but **before**
  any worktree work is done.
- It runs only when the spec path resolves into a registered project's root
  (the existing happy path). If the spec is outside any project, the
  current flow already exits with an error; no new check is needed there.
- Two conditions trigger the prompt:
  1. The spec file is **untracked** in the project root's working tree
     (`git ls-files --error-unmatch <specPath>` exits non-zero).
  2. The spec file is **tracked but modified** in the project root's
     working tree (`git status --porcelain -- <specPath>` returns a
     non-empty line that is not purely "??").
  - For a multi-file index spec, the check applies to the supplied spec
    path itself (the `index.md` file). Sibling subspecs are intentionally
    out of scope for v1 — they can be authored alongside the index, and
    a follow-up spec can extend the check to the whole spec directory if
    needed. Note this limitation in code comments and in the prompt
    rationale section.
- The git commands run against the **project root**, not the worktree.
  The worktree may not exist yet at this point in the flow.
- The prompt is a `[y/N]` confirmation. Default on empty input is `N`
  (do not proceed). Unrecognized input re-prompts once, then exits 0.
- The prompt is suppressed when stdin is not a TTY (e.g., scripted runs).
  In non-TTY mode, jarvis prints a warning to stderr and continues — it
  does not refuse to run. This matches jarvis's broader pattern of being
  noisy but not blocking.
- The prompt uses the existing `ConfirmRun` injection point in
  `src/commands/run.ts` (the same one used by the non-index prompt in
  subspec 00 of `spec/light-spec-migration/`). Reuse the same
  `confirmFromStdin` fallback.

## Behavior

Suggested prompt text when the spec is untracked:

```text
<SPEC_PATH> is not committed on the base branch (<BASE>).
Specs should be committed before running jarvis so they don't get swept
into the implementation PR. See
docs/spec-guidance.md#commit-specs-before-running-jarvis.

Proceed anyway? [y/N]:
```

When the spec is tracked but modified, replace the first line with:

```text
<SPEC_PATH> has uncommitted modifications on the base branch (<BASE>).
```

`<BASE>` comes from `getBaseBranch()` in `src/gh.ts` (already imported by
the worktree module). If `getBaseBranch()` fails (e.g., no upstream
configured), omit the `<BASE>` parenthetical rather than aborting the run.

On `y`: proceed with the existing flow. The spec will be copied into the
worktree as it is today.

On `n`, empty input, or unrecognized-twice: exit 0 without invoking any
agent. Do not create or modify a worktree.

When stdin is not a TTY: print the same warning text to stderr, then
proceed.

## Tasks

- [ ] Add a helper, e.g. `checkSpecCommitted(specPath, projectRoot)`, that
  returns one of `"committed"`, `"untracked"`, or `"modified"`. Put it in a
  new module under `src/` (suggested: `src/spec-state.ts`) so it is unit
  testable in isolation.
- [ ] Call the helper in `src/commands/run.ts` after spec validation and
  project resolution, before `ensureWorktree`. Skip when the helper
  returns `"committed"`.
- [ ] Render the appropriate prompt text and use the `ConfirmRun` plumbing
  to get the answer.
- [ ] Detect non-TTY stdin (`process.stdin.isTTY === false`) and switch to
  the warn-and-continue behavior.
- [ ] Add unit tests for `checkSpecCommitted`:
  - returns `"committed"` for a tracked, clean file
  - returns `"untracked"` for a brand-new file
  - returns `"modified"` for a tracked file with edits
  - tolerates absolute and project-relative spec paths
- [ ] Add a command-level test for the run flow using the existing
  `confirmRun` injection point:
  - prompt fires when the spec is untracked
  - `y` proceeds (asserting that `ensureWorktree` is called)
  - `n`/empty exits 0 without invoking any agent
- [ ] Note in code comments that v1 only checks the supplied spec path,
  not sibling subspec files in the same directory.

## Acceptance criteria

- A `jarvis run` against an untracked spec prompts with the text above and
  honors `y`/`n`/empty/unrecognized as documented.
- A `jarvis run` against a tracked-but-modified spec prompts with the
  modified-variant text.
- A `jarvis run` against a clean, committed spec does not prompt.
- Non-TTY runs warn on stderr and proceed without prompting.
- `bun run typecheck`, `bun test`, and `bun run check` all pass.
- No regression to the existing non-index prompt from
  `spec/light-spec-migration/`.

## Documentation updates

User-visible docs for this prompt land in subspec 02 once the behavior is
in place. This subspec only adds inline code comments.
