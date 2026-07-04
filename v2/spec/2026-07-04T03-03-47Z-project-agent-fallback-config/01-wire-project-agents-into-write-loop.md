# 01 - Wire project config into write-loop-input + CLI

Replace the hardcoded `DEFAULT_WRITE_AGENTS` fallback in
`v2/src/execution/write-loop-input.ts` with the loader from
[00](./00-project-agent-config-loader.md), keeping CLI `--agents` as a per-run
override.

## Prerequisites

00-project-agent-config-loader.md is complete.

## Decisions

- Outer agent list precedence: CLI `--agents` > project config `agents` > `DEFAULT_WRITE_AGENTS` (`["claude"]`) — CLI stays a per-run bypass per intent; the hardcoded default only applies when neither CLI nor project config supplies a list.
- `write-loop-input.ts` stays pure (no fs I/O): it gains an optional fallback-agents parameter, resolved and passed in by `cli.ts`, which is the only caller that loads `~/.jarvis/projects.json` — rules out adding fs access inside the already-pure/tested `buildWriteLoopInput*` functions.

## Task checklist

- [ ] `buildWriteLoopInput` / `buildWriteLoopInputFromCliValues` accept an optional fallback agents list, used only when the CLI/fields omit `agents`.
- [ ] `jarvis write` / `jarvis run start` in `cli.ts` call `loadProjectAgents(projectName)` and pass the result (or `DEFAULT_WRITE_AGENTS` when `undefined`) as that fallback.

## Acceptance criteria

- [ ] `jarvis write --project <name>` with no `--agents` and a matching `~/.jarvis/projects.json` entry launches with that project's configured agent order.
- [ ] `jarvis write --project <name> --agents <csv>` uses the CLI list even when a project config entry exists for `<name>`.
- [ ] `jarvis write --project <name>` with no `--agents` and no project config entry (or no file) falls back to `DEFAULT_WRITE_AGENTS`.
- [ ] `write-loop-input.test.ts` and `cli.test.ts` cover all three precedence cases above.

## Documentation updates

- `v2/docs/write-behavior.md`: update the `--agents` bullet to state the precedence (CLI > project config > default) and name `~/.jarvis/projects.json`.
- `v2/docs/agent-model-config.md`: cross-link the "Per-machine project config" example to this loader instead of leaving it unimplemented-illustrative.
