# 02 - Claude and Codex sibling workspace access

## Problem

Claude already consumes `additionalReadDirs` and passes each directory as `--add-dir`. Codex currently ignores the same option even though `codex exec --help` exposes `--add-dir <DIR>` as "Additional directories that should be writable alongside the primary workspace." Project siblings must work for both agents.

This subspec covers only Claude and Codex because both have the same CLI-level workspace-extension mechanism.

## Decisions

### Claude

`src/agents/claude.ts` should not need a functional change: it already iterates `opts.additionalReadDirs ?? []` and appends `--add-dir <dir>` after `--permission-mode acceptEdits`.

Add or keep a targeted test asserting multiple `additionalReadDirs` become repeated `--add-dir` pairs. The test should cover more than one directory so ordering and repetition are explicit.

### Codex

Update `src/agents/codex.ts` so `buildArgv` appends `--add-dir <dir>` for each `opts.additionalReadDirs ?? []`.

Keep the existing safe-edits posture:

```txt
codex exec --color never --sandbox workspace-write -c approval_policy="on-request"
```

Do not use `danger-full-access` or `--dangerously-bypass-approvals-and-sandbox`.

The installed Codex CLI in this repo supports:

```txt
--add-dir <DIR>  Additional directories that should be writable alongside the primary workspace
```

### Documentation

Update `docs/agents.md` so the Claude and Codex rows mention that Jarvis repeats `--add-dir <path>` for configured project siblings and external spec directories.

## Out of scope

- Cursor, Opencode, and Aider support; those are separate subspecs.
- Changing the run-loop config schema; subspec 01 owns that.
- Renaming `additionalReadDirs`.

## Tasks

- [ ] Confirm `src/agents/claude.ts` still appends `--add-dir <dir>` for every `additionalReadDirs` entry.
- [ ] Add or update `test/agents/claude.test.ts` to assert multiple additional directories produce repeated `--add-dir` flags.
- [ ] In `src/agents/codex.ts`, append repeated `--add-dir <dir>` pairs for `opts.additionalReadDirs ?? []`.
- [ ] Add or update `test/agents/codex.test.ts` to assert repeated `--add-dir` flags appear with the existing sandbox and approval flags.
- [ ] Update `docs/agents.md` for Claude and Codex sibling-directory behavior.

## Acceptance criteria

- [x] Claude receives every configured sibling directory as `--add-dir <path>`.
- [x] Codex receives every configured sibling directory as `--add-dir <path>`.
- [x] Codex keeps `--sandbox workspace-write` and `-c approval_policy="on-request"`.
- [x] Neither adapter uses a dangerous bypass flag.
- [x] TypeScript compiles without errors.
- [x] Agent docs mention sibling directory forwarding for Claude and Codex.
