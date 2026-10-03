# Remove `run start` CLI surface

## Primary implementation surface

- `v2/src/commands/run.ts`
- `v2/src/commands/write.ts`
- `v2/src/cli/command-tree.ts`, `v2/src/cli/usage.ts`, `v2/src/cli/help-flags-parity.ts`, `v2/src/cli/command-help-flags.ts`
- `v2/src/commands/run.test.ts`, `v2/src/cli.test.ts`
- `v2/src/execution/write-loop-input.ts` (comment-only references to `run start` argv)

## Problem

Operators still discover and invoke `jarvis run start`, which admitted the only durable direct-write rows this spec retires. Help, usage, command-tree coverage, and CLI tests still advertise and dispatch it.

## Decisions

- Remove the `start` branch from `run` dispatch and drop `parseWriteCliInput` entirely from `write.ts` — rules out a non-exported helper with no callers.
- Remove the `run` → `start` command-tree node and `RUN_START_USAGE` from operator-facing help — rules out `jarvis help run start`.
- Delete `run.test.ts` `describe("run start")`, the subspec 00–ported `run start` cases under `dispatch to keyed daemons` and `keyed daemon auto-start on dispatch`, and `cli.test.ts` help/dispatch pins for `run start` — rules out orphan tests for a removed verb.
- Keep `parseWriteArgs` / `buildWriteLoopInputFromCliValues` in `write-loop-input.ts` when still referenced by workflow admission or `write-loop-input.test.ts` — rules out deleting shared parsers still used off-CLI.
- Collateral deletion for the thirteen tests in `run.test.ts` `describe("run start")` (lines 111–385 on main): (1) subspec 00 ports — delete here only; (2) CLI write-arg / machine-config validation (`missing required write args`, `--max-iterations`, unknown args, inverted iteration bounds, invalid machine config) — move surviving assertions to `write-loop-input.test.ts` or workflow CLI tests where the same parsers run, else intentional retirement because workflow admission owns a different argv surface; (3) IPC payload pins (`params.input`, bindingResolution, iteration timeouts, operatorSessionId, daemon guard passthrough, machine-config agent forwarding) — intentional retirement because only direct `run start` used `params.input`; workflow payload shape stays covered by subspec 00 and existing `workflow.test.ts` / daemon workflow-start tests — rules out re-porting every `params.input` assertion onto workflow argv.

## Task checklist

- Update `RUN_USAGE` and dispatch-coverage tables to exclude `start`.
- Map `jarvis run start …` to the same unknown-subcommand path as retired `run pause` (usage error, no IPC).
- Remove exports and imports of `parseWriteCliInput`.

## Acceptance criteria

- [ ] `v2/src/cli.test.ts` `help run` / tree coverage no longer lists `run start`; `jarvis run start` exits non-zero with usage on stderr and sends no IPC (case parallel to `run pause is an unknown subcommand` in `run.test.ts`); fails on main while `run start` remains registered.
- [ ] `grep -rn parseWriteCliInput v2/src --include='*.ts'` returns zero matches.
- [ ] `grep -n 'describe("run start")' v2/src/commands/run.test.ts` returns zero matches after deletion; subspec 00 workflow keyed dispatch describe stays green.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- Defer operator prose to subspec 04; no doc edits in this subspec.
