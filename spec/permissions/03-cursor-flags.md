# 03 - Cursor permission flags

## Problem

`cursor agent -p` refuses to write files in print mode unless `--force` is
passed. Without it, every spec run that needs to edit a file fails.

## Decisions

- Pass `--force` on every `cursor agent -p` invocation.
  - `--force` only opts into print-mode writes; it does not bypass the
    permission rules configured in `~/.cursor/cli-config.json` or a project's
    `.cursor/cli.json`. Users who want stricter rules can layer them in
    those files without jarvis changes.
- Do not write a `.cursor/cli.json` into the target repo. Cursor's defaults
  plus `--force` match the `safe-edits` posture.

## Tasks

- [ ] In `src/agents/cursor.ts`, add `--force` to `argv` in the
      `agent -p --output-format text` block, before `--workspace`.
- [ ] Update the top-of-file comment to mention `--force` and link to this
      subspec.
- [ ] Add a test that asserts `--force` is present in the spawned argv.

## Acceptance criteria

- A jarvis run using cursor against a spec that edits files in the worktree
  succeeds and the edits land on disk.
- Removing `--force` causes the test to fail.
