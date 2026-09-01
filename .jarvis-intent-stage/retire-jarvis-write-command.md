---
name: retire-jarvis-write-command
---

# Retire the `jarvis write` CLI command

## Prerequisites

## Problem

`jarvis write` has zero production callers (`cli.ts` is the only `executeWriteLoop` dispatch site), zero operator-runbook mentions, and no feature work since 2026-07-17. Workflows and pipelines own write execution now.

## Behavior

`jarvis write` is unknown at top-level dispatch and absent from `jarvis help`. Remove the write command handler, command-tree entry, `CliDeps.executeWriteLoop`, `writeStdoutJson`, the write parity CLI path, and `write.test.ts`. Keep `parseWriteCliInput` and the shared write-flag parser consumed by `jarvis run start`.

## Decision ledger

- Keep `parseWriteCliInput` while `run start` lives; rules out deleting the shared parser with the command surface.
- Remove `CliDeps.executeWriteLoop` and the CLI write dispatch path only; rules out deleting `executeWriteLoop` from `write-loop.ts` (workflows and daemon still call it).
- Delete the command outright; rules out a deprecation window for an unused operator surface.

## Acceptance criteria

- [ ] `cli.test.ts` pins `jarvis write` as unknown at dispatch and absent from `jarvis help`; `CliDeps` has no `executeWriteLoop`; the tests fail against the pre-fix command tree.
- [ ] `jarvis run start` still parses write flags through `parseWriteCliInput`; existing `run.test.ts` write-flag coverage stays green.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/v1-behaviors.md` — record removal of the `jarvis write` top-level command; `run start` and workflow write steps remain.
