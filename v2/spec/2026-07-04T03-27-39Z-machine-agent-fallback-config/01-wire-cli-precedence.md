# Wire machine config into the write CLI

Replace the hardcoded `DEFAULT_WRITE_AGENTS` fallback in
`v2/src/execution/write-loop-input.ts` with the per-machine config loaded from
[00 - Machine config loader](./00-machine-config-loader.md), keeping `--agents`
as a per-run override.

## Decisions

- Precedence: CLI `--agents` > machine config `agents` > `DEFAULT_WRITE_AGENTS` (`["claude"]`).
- `write-loop-input.ts` stays pure (no fs I/O): it accepts the resolved fallback agent list as a parameter instead of hardcoding `DEFAULT_WRITE_AGENTS` internally; `DEFAULT_WRITE_AGENTS` remains its default value when no fallback is supplied.
- `cli.ts` loads the machine config only when `--agents` is absent, and passes the resolved fallback (machine config `agents`, or `DEFAULT_WRITE_AGENTS` if `undefined`) into `buildWriteLoopInputFromCliValues`. When `--agents` is present, the machine config is never loaded — its content, valid or not, cannot affect that run.
- A structurally invalid machine config surfaces as a `jarvis write` / `jarvis run start` load error (nonzero exit) only when `--agents` is absent; it is never a silent fallback to defaults.
- Confirmed in `cli.ts`: `jarvis write` and `jarvis run start` both resolve through the shared `parseWriteCliInput` → `buildWriteLoopInputFromCliValues` path, so one fallback-agents parameter covers both commands.

## Task checklist

- [ ] Add a fallback-agents parameter to `buildWriteLoopInput` and `buildWriteLoopInputFromCliValues`, used when `--agents` is omitted, defaulting to `DEFAULT_WRITE_AGENTS`.
- [ ] In `cli.ts`, load the machine config only when `--agents` is absent, before parsing write args, and pass the resolved fallback through for both the `write` and `run start` commands.
- [ ] Surface a machine-config load error as a CLI error (nonzero exit, message on stderr) rather than letting it propagate as an uncaught throw.

## Acceptance criteria

- [ ] `jarvis write` / `jarvis run start` without `--agents` and without a machine config file uses `["claude"]`.
- [ ] `jarvis write` / `jarvis run start` without `--agents` and with a machine config `agents` list uses that list.
- [ ] `jarvis write` / `jarvis run start` with `--agents` uses the CLI value, regardless of whether machine config is missing, valid, or structurally invalid.
- [ ] `jarvis write` / `jarvis run start` without `--agents` and with a structurally invalid machine config file exits nonzero with an error message, without invoking any agent.
- [ ] `write-loop-input.test.ts` existing tests stay green (behavior unchanged for callers that don't pass a fallback).
- [ ] Omitting the fallback-agents parameter to `buildWriteLoopInput` / `buildWriteLoopInputFromCliValues` defaults to `DEFAULT_WRITE_AGENTS`.
- [ ] `bun run typecheck` and `bun run test` pass.

## Documentation updates

- Update [`v2/docs/agent-model-config.md`](../../docs/agent-model-config.md) to note the CLI `--agents` > machine config > `DEFAULT_WRITE_AGENTS` precedence for the write/run-start commands.
