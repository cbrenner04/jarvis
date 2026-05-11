# 11 — Completion detection

Determine whether a target-repo spec is complete.

## Rule

A spec file is **complete** when it contains zero unchecked GitHub-style task list items, i.e. no lines matching the pattern `^\s*- \[ \]\s` (case-insensitive on the bracket contents — only a literal space counts as unchecked; `- [x]` and `- [X]` are checked).

A spec file with **no checkboxes at all** is treated as **malformed** — it is unprocessable. `isComplete` throws a typed error (`MalformedSpecError`) so the loop can fail fast with a clear message rather than silently exiting.

## Tasks

- [x] `src/completion.ts` exports `isComplete(specPath: string): boolean` and `countUnchecked(specPath: string): number`.
- [x] Tests cover: all checked, mix, all unchecked, no-checkboxes (throws `MalformedSpecError`), file-not-found (throws with clear message).

## Acceptance criteria

- Tests pass.
- Pure read-only; no mutation of the spec file.

## Documentation updates

- Document the completion rule in `README.md` under a new "How jarvis decides the spec is done" subsection.
