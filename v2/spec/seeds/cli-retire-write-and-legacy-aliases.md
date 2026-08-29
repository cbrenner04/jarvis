---
name: cli-retire-write-and-legacy-aliases
---

# Retire `jarvis write`, the legacy workflow aliases, and the dead TUI start verb

## Problem

The 2026-08-29 CLI inventory found three operationally dead surfaces. `jarvis write`: zero production callers (`cli.ts:56` is the only `executeWriteLoop` site), zero operator-runbook mentions, no feature commit since 2026-07-17 — everything runs through workflows/pipelines now. The three hidden legacy aliases (`intent-reviewed`, `plan-reviewed`, `plan-reviewed-light`, `workflow-args.ts:196-202`) already print deprecation warnings and are absent from the help tree; the reviewed plan path is also known-broken (reports a false `killed` and strands the spec; operator guidance is plain `plan`). `TuiDaemonClient.start` (`tui-daemon-client.ts:43,128`) is exercised only by its own tests; the TUI `start` verb goes through pipeline admission.

## Decisions

- Delete the `write` command surface: handler (`cli.ts:35-61,108`), tree entry, `CliDeps.executeWriteLoop`, `writeStdoutJson`, its parity path, and `write.test.ts`; keep `parseWriteCliInput` (consumed by `run start`). Rules out deleting the shared parser while `run start` lives.
- Delete the three legacy aliases and their deprecation plumbing (`workflow.ts:123,197-224,334-343`). Single-operator repo; no external consumer. Rules out an alias sunset window.
- Delete `TuiDaemonClient.start` and its tests. Rules out dead RPC client surface.
- Docs that demo `write` re-point to `run workflow` (`README.md:83`, `write-behavior.md`, `install-and-config.md:186,243,245`, `agent-model-config.md:221`, `daemon-host.md:13`, `v1-behaviors.md:561`). Rules out docs teaching a removed command.

## Acceptance criteria

- [ ] `jarvis write` is unknown at dispatch and absent from `jarvis help`; no `executeWriteLoop` symbol remains, pinned by CLI tests.
- [ ] The legacy alias strings resolve to unknown-workflow errors; no deprecation plumbing remains, pinned by tests.
- [ ] `TuiDaemonClient` has no `start`; TUI start still admits pipelines, pinned by existing TUI tests.
- [ ] No doc references `jarvis write` as a command, pinned by `bun run lint:md` plus grep.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- Listed re-points above, plus `v2/docs/write-behavior.md` retitles its CLI examples around `run workflow`.
