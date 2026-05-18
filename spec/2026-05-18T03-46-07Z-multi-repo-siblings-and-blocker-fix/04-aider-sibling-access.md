# 04 - Aider sibling workspace access

## Problem

Aider currently ignores `additionalReadDirs` and runs from a single cwd:

```txt
aider --message "<prompt>" --model <provider/model> --yes-always --no-auto-commits --no-git --no-stream
```

Project siblings must be available when Aider is selected. Aider is different from the other agents because it has explicit file-scope flags (`--file`, `--read`) and positional files, and it normally reasons through a git repository rooted at cwd unless told otherwise.

## Decisions

### Verification first

Before changing behavior, verify Aider's supported way to include files outside cwd for editing. The installed help shows:

- `--file FILE`: specify a file to edit, repeatable.
- `--read FILE`: specify a read-only file, repeatable.
- `--no-git`: already used so Jarvis remains the only committer.

This does not prove that passing an entire sibling directory as a positional file or `--file` value is accepted, so implementation must verify the behavior locally or with a fake/integration-style test that exercises argv construction and documents the chosen mechanism.

### Preferred implementation

Use the least surprising Aider mechanism that supports writable sibling paths:
- If Aider accepts directory paths as positional editable targets, append each sibling directory as a positional argument after existing flags.
- If Aider requires `--file <path>` and accepts directories there, repeat `--file <sibling>`.
- If Aider cannot accept whole directories, use the shared prompt text from subspec 01 and add a clear limitation to docs explaining that Aider may need explicit file paths before it can edit a sibling repo.

Do not enable Aider auto-commits, do not remove `--no-git`, and do not add broad skip-permission flags beyond the existing `--yes-always`.

If Aider cannot support sibling edits without abandoning Jarvis-owned commits or requiring unsafe behavior, append a `## Blocker` section explaining the exact verified limitation and stop.

### Documentation

Update `docs/agents.md` so the Aider row documents how sibling directories are exposed and any Aider-specific limitation.

## Out of scope

- Claude, Codex, Cursor, and Opencode support.
- Per-file sibling discovery in the run loop.
- A new Aider-specific config field for preselected files.

## Tasks

- [ ] Verify whether Aider accepts sibling directories as editable targets via positional args or `--file <path>`; record the result in this subspec if it changes the implementation.
- [ ] Update `src/agents/aider.ts` to handle `additionalReadDirs` with the verified Aider mechanism, or document a blocker if no safe mechanism exists.
- [ ] Preserve `--yes-always`, `--no-auto-commits`, `--no-git`, and `--no-stream`.
- [ ] Add or update `test/agents/aider.test.ts` for `additionalReadDirs` behavior.
- [ ] Update `docs/agents.md` for Aider sibling-directory behavior and any limitations.

## Acceptance criteria

- [ ] Aider can be selected for a project with configured siblings without silently dropping the sibling context.
- [ ] Aider preserves Jarvis-owned commit behavior: `--no-auto-commits` and `--no-git` remain present.
- [ ] Aider does not use a dangerous bypass flag beyond the existing `--yes-always` confirmation posture.
- [ ] Tests cover Aider receiving `additionalReadDirs`.
- [ ] TypeScript compiles without errors.
- [ ] Agent docs describe the Aider sibling behavior.
