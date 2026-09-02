# Retire `jarvis write` CLI dispatch and deps

## Problem

`jarvis write` has zero production callers (`cli.ts` is the only `executeWriteLoop` dispatch site), zero operator-runbook mentions, and no feature work since 2026-07-17. Workflows, pipelines, and `jarvis run start` own write admission now; the standalone top-level command is dead surface.

## Behavior

`jarvis write` is unknown at top-level dispatch and absent from `jarvis help`. Remove the write command handler, command-tree entry, top-level help node, `CliDeps.executeWriteLoop`, `writeStdoutJson`, the write parity CLI path, and `v2/src/commands/write.test.ts`. Keep `parseWriteCliInput`, the shared write-flag parser consumed by `jarvis run start`, and `v2/src/execution/write.test.ts`. `executeWriteLoop` in `write-loop.ts` stays — workflows and the daemon still call it.

`run start` retains write-flag help and parse-error usage via a `run start`-scoped usage constant (replacing the `jarvis write`-worded `WRITE_USAGE`); `WRITE_HELP_FLAGS` stay on the `run start` help node.

## Decision ledger

- Delete `jarvis write` outright; rules out a deprecation window for an unused operator surface.
- Keep `parseWriteCliInput` while `run start` lives; rules out deleting the shared parser with the command surface.
- Remove `CliDeps.executeWriteLoop` and the CLI write dispatch path only; rules out deleting `executeWriteLoop` from `write-loop.ts`.
- Repoint `run start` help/error usage from `WRITE_USAGE` to a `run start`-scoped constant; rules out keeping `usage: jarvis write` on the surviving admission path.
- Typos formerly suggesting `write` (`wrte`, `writex`, `wrote`, `wte`) get no Levenshtein suggestion once `write` leaves the registry; rules out keeping `did you mean write?` for a removed surface.
- Comprehensive operator-doc sweep deferred to `align-docs-after-write-retirement`; rules out editing every `jarvis write` mention in this slice.

## Tasks

- Remove `runWriteCommand`, the `write` `commandEntry`, and write-only imports (`resolveWriteLoopBindings`, `writeStdoutJson`, `exitCodeForWriteResult`, `applyOperatorSessionId`, etc.) from `v2/src/cli.ts`.
- Remove the top-level `write` node from `v2/src/cli/command-tree.ts`; keep `WRITE_HELP_FLAGS` on `run start`.
- Replace `WRITE_USAGE` with a `run start`-scoped usage constant in `v2/src/cli/usage.ts`; update `v2/src/cli/command-tree.ts`, `v2/src/commands/run.ts`, and any remaining imports.
- Remove `executeWriteLoop` from `CliDeps` and `createRuntimeDeps` in `v2/src/cli/deps.ts`.
- Delete `writeStdoutJson` from `v2/src/commands/write.ts`; keep `parseWriteCliInput` and the `exitCodeForWriteResult` re-export if still referenced.
- Partition `v2/src/commands/write.test.ts` before deletion:
  - Migrate to `v2/src/commands/run.test.ts`: the three `parseWriteCliInput` failure cases (`missing required write args`, `invalid --max-iterations`, `unknown write args`) and machine-config/binding admission cases (`write resolves iterationTimeoutMs and iterationCeilingMs from machine config`, `write rejects inverted write-path iteration bounds before the loop`, `mints an operatorSessionId when no caller-supplied telemetry is present`, `defaults to the claude agent when machine config has no override`, `valid machine config supplies fallback agents`, `invalid machine config exits nonzero without invoking any agent`, `write resolves bindings from the agent model config before the loop`) — drive `run start` instead of `write`.
  - Move `applyOperatorSessionId overwrites caller-supplied operatorSessionId, preserves other telemetry fields` to a `write-loop` unit test (e.g. colocated with `v2/src/execution/write-loop.ts`).
  - Delete with the removed CLI surface: `write command maps … to exit …`, `write stdout failureKind and bindingAttempts attach only on binding-chain invocation_failure` (they pin `writeStdoutJson` / in-process `executeWriteLoop` dispatch only).
- Delete `v2/src/commands/write.test.ts`.
- Drop `executeWriteLoop` stubs from `v2/src/commands/run.test.ts`, `v2/src/commands/daemon.test.ts`, and `v2/src/commands/config.test.ts`.
- Update `v2/src/cli.test.ts`:
  - Pin `jarvis write` as unknown at top-level dispatch.
  - Remove `write` from `commandNames` and the top-level help registry line (`write\tRun an in-process write loop.`).
  - Update `registry owns dispatched commands, metadata, and exact-name lookup` to drop `WRITE_USAGE` from the usage array.
  - Remove `write` from the dispatch-coverage tree walk (`the driven paths are walked from the tree, not hand-written`).
  - Repoint `help run start prints …` and flag/usage table rows from `WRITE_USAGE` to the new `run start` constant; remove the `write` row and `help run start flag lines match help write` parity test.
  - Remove `help write nope is unknown at depth 1 (past a leaf)`.
  - Update Levenshtein cases `wrte`/`writex`/`wrote`/`wte` to expect no suggestion (remove them from the suggesting table or assert `undefined` suggestion).
- Align `v2/src/cli/command-help-flags.ts` comment to `run start` only.

## Acceptance criteria

- [ ] `v2/src/cli.test.ts` rejects `jarvis write` at top-level dispatch with the standard unknown-command error and omits `write` from the `jarvis help` registry output; reachable today via `main(["write", ...])` and the `help` registry test — fails against the pre-fix command tree.
- [ ] `v2/src/cli/deps.ts` exports a `CliDeps` type with no `executeWriteLoop` member; fails against the pre-fix type.
- [ ] `v2/src/commands/write.test.ts` is absent from the tree.
- [ ] `v2/src/cli.test.ts` `help run start prints …` and `run start` parse-error paths no longer emit `usage: jarvis write`; fails against the pre-fix tests that assert `WRITE_USAGE` / `usage: jarvis write`.
- [ ] `v2/src/cli.test.ts` Levenshtein cases for `wrte`/`writex`/`wrote`/`wte` no longer suggest `write`; fails against the pre-fix `a %s close match suggests the registered command` table.
- [ ] `v2/src/commands/run.test.ts` migrated parse-error cases (`missing required write args`, `invalid --max-iterations`, `unknown write args`) stay green on the `run start` path.
- [ ] `v2/src/commands/run.test.ts` `run start sends one IPC start request carrying write-loop input and prints run ID` stays green.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` passes.

## Documentation updates

None in this subspec — `v1-behaviors.md` is subspec 01; broader operator-doc sweep is deferred to `align-docs-after-write-retirement`.
