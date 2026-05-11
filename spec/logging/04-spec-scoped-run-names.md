# 04 — Spec-scoped run names

## Problem

`jarvis run` is normally invoked against a spec directory's `index.md`, but the terminal banner currently displays `spec: index.md`. The log namespace is also only the registered project key, which makes multiple concurrent runs for different specs in the same repo hard to distinguish.

## Decisions

- For an index spec, the spec display name is the containing directory name.
- For a direct non-index spec run, keep using the file basename as the spec display name.
- The run namespace includes both the project key and spec display name as `projectKey:specName`.
- Use the same run namespace for the log server and session file naming so persisted and live logs agree.

## Tasks

- [x] Update the run banner and annotations to use the spec display name instead of always using `basename(specPath)`.
- [x] Update log namespace creation so it includes the spec display name.
- [x] Add or adjust tests for terminal output, log server payloads, and session file naming.

## Acceptance criteria

- `jarvis run spec/logging/index.md` prints `spec: logging`, not `spec: index.md`.
- Log server messages carry a namespace that distinguishes specs within the same project.
- Session file names include the spec display name.
- `bun run typecheck` and `bun test` pass.

## Documentation updates

- `README.md`: update session/logging docs to describe directory-based spec display names and spec-scoped namespaces.
