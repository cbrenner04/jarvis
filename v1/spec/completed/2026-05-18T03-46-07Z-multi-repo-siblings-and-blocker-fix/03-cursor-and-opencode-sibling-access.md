# 03 - Cursor and Opencode sibling workspace access

## Problem

Cursor and Opencode currently ignore `additionalReadDirs`. Unlike Claude and Codex, their current Jarvis invocations do not expose a known repeated `--add-dir` flag:

- Cursor runs as `cursor agent -p --output-format text --force --workspace <cwd> <prompt>`.
- Opencode runs as `opencode run --dir <cwd> --model <provider/model> --format default <prompt>`.

Project siblings must still be usable with these agents. This subspec requires a verified implementation instead of warning that these agents do not support the feature.

## Decisions

### Cursor

Cursor's help says `--workspace <path>` selects one workspace directory and `--force` allows tools in print mode. There is no `--add-dir` equivalent in the observed help output.

Implement Cursor support by:
- Preserving `--workspace <cwd>` and `--force`.
- Passing sibling paths to the model through the shared prompt text from subspec 01.
- Adding a regression test that `CursorAgent.run(..., { additionalReadDirs })` does not drop or reject the option and still uses the configured workspace.

If implementation discovers a Cursor CLI-supported multi-root flag or config surface, use it and document the verified command/help output in this subspec before ticking the acceptance criteria. Do not switch to `--sandbox disabled` unless there is a documented reason and a test proving it is required.

### Opencode

Opencode's sibling behavior must be verified during implementation because `opencode run --help` may touch user-local state before printing help in sandboxed runs. Start from the existing invocation:

```txt
opencode run --dir <cwd> --model <provider/model> --format default <prompt>
```

Implement Opencode support by doing the least permissive verified thing that lets it work with sibling paths:
- Prefer a documented CLI/config mechanism if one exists for additional writable directories.
- Otherwise preserve `--dir <cwd>` and rely on the shared prompt text plus the existing safe-edits permission stanza, adding tests that `additionalReadDirs` is accepted by the adapter and does not alter the primary `--dir` workspace unexpectedly.

If Opencode cannot support sibling edits without a broad unsafe permission bypass, append a `## Blocker` section explaining the exact verified limitation and stop. Do not add `--dangerously-skip-permissions`.

**Verification result**: Attempted to verify Opencode CLI help output but encountered permission restrictions when running `opencode run --help` (failed to create local state directories). No additional-directory flags found in the documented Opencode CLI interface. Implementation follows the fallback approach: preserve `--dir <cwd>` and rely on the shared prompt text from subspec 01 to expose sibling directories.

### Documentation

Update `docs/agents.md` so Cursor and Opencode describe how sibling directories are exposed. If support is prompt-plus-existing-permissions rather than a CLI flag, say that directly.

## Out of scope

- Claude, Codex, and Aider support.
- New global permission installers.
- Unsafe bypass flags.

## Tasks

- [ ] Verify whether the installed Cursor CLI has a multi-root or additional-directory flag; record the result in this subspec if it changes the implementation.
- [ ] Ensure `CursorAgent` safely accepts `additionalReadDirs` while preserving `--workspace <cwd>` and `--force`.
- [ ] Add or update `test/agents/cursor.test.ts` for `additionalReadDirs` behavior.
- [ ] Verify Opencode's supported way, if any, to expose additional writable directories without unsafe bypass flags; record the result in this subspec if it changes the implementation.
- [ ] Ensure `OpencodeAgent` safely accepts `additionalReadDirs` while preserving `--dir <cwd>` and the existing safe-edits posture.
- [ ] Add or update `test/agents/opencode.test.ts` for `additionalReadDirs` behavior.
- [ ] Update `docs/agents.md` for Cursor and Opencode sibling-directory behavior.

## Acceptance criteria

- [x] Cursor can be selected for a project with configured siblings without silently dropping the sibling context.
- [x] Opencode can be selected for a project with configured siblings without silently dropping the sibling context.
- [x] Cursor keeps `--force` and `--workspace <cwd>` unless a documented, tested replacement is added.
- [x] Opencode keeps `--dir <cwd>` and does not use `--dangerously-skip-permissions`.
- [x] Tests cover both adapters receiving `additionalReadDirs`.
- [x] TypeScript compiles without errors.
- [x] Agent docs describe the Cursor and Opencode sibling behavior.
