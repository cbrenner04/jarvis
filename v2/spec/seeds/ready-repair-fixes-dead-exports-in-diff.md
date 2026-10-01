---
name: ready-repair-fixes-dead-exports-in-diff
---

# Ready-gate repair adds out-of-fence references instead of unexporting dead exports

## Problem

When `bun run check` fails only on `scripts/guard-dead-exports.ts` (`<file>:<line>: unreferenced export <Name>`, the last line after biome warnings and a "diagnostics exceed limit" notice), ready-gate repair satisfies the static guard by importing the symbol from a file outside the attributable allowset instead of demoting or deleting the export. The fence refuses and reverts the edit, and the run settles non-resumable `completion_commit_failed`. The repair agent is never told which paths it may edit, and the guard's message does not name the fix.

## Evidence

- 2026-10-01 run `c9f0b7fe` (pipeline `4a0b9cb4`, lane `fan-out-lane-terminal-publication-durable-outcomes`): `v2/src/persistence/state-store.ts:296: unreferenced export StageTerminalPublication` (used only in-file). Repair edited `v2/src/persistence/pipeline-stage-settlement.ts`; `loop_finished` recorded `Ready-gate repair stages path outside run diff and spec tree: v2/src/persistence/pipeline-stage-settlement.ts; refused paths reverted`. Operator hand-fix: drop `export` (`ab9b208cb`).
- `reports/20261001T133500Z-operator-structural-recovery.md` ("Ready-gate dead export (816dabdf)"): same shape, hand-dropped after 10 iterations.
- The guard line reaches the agent: `GATE_OUTPUT` is the failed step's output tail (`write-loop.ts:3530-3539`, `selectFailedReadyStepOutput` at `ready-finalize.ts:434`, 16 KiB tail cap at `write-loop.ts:671`), and the guard prints last (`guard-dead-exports.ts:95`). Missing is direction, not data.
- `prompts/write/ready-repair.md` has no allowed-paths placeholder; the fence allowset (`resolveAttributableRepairAllowset`, `ready-finalize.ts:1021`; marker-attributed paths only, else frozen run diff + spec tree, which is what refused `c9f0b7fe`) is computed only after the agent returns (`write-loop.ts:4326-4334`).
- Built-in autofix is scoped `biome check --write --unsafe` only (`write-loop.ts:4553-4583`); it cannot fix a guard finding.
- `ready_gate_repair` logs only `attempt` and `gateExitCode` (`log-stream.ts:26-30`), so `jarvis run log` cannot show what the agent was asked to fix.

## Decisions

- Guard message names the fix: `<file>:<line>: unreferenced export <Name> (demote to module-private if used in-file, else delete; never add an import to satisfy the guard)`. Matches `coding-standards.md` dead-export rule. The `<file>:<line>:` prefix stays.
- `write.ready-repair` gains an `ALLOWED_PATHS` placeholder: the attributable allowset for this gate error (the same set the fence enforces), rendered one path per line, with one sentence stating edits outside it are reverted and end the run. Prompt revision bumps. Generic across target repos.
- `ready_gate_repair` event gains `failingStep` (the `GATE_STEP` value) and a bounded `gateOutputTail` (last 4 KiB of the step output, same cap as `AUTOFIX_TYPECHECK_OUTPUT_TAIL_MAX`).
- Rejected: harness-side deterministic unexport in built-in autofix. The guard is this repo's script, not a harness contract; baking it into `runBuiltInReadyGateAutofixBiome` couples the harness to one target repo.
- Rejected: making a fence refusal reprompt instead of settle. Separate behavior change; out of scope.

## Acceptance criteria

- [ ] `scripts/guard-dead-exports.test.ts`: an in-file-only export reports the new message with the `<file>:<line>:` prefix intact; fails against the old message.
- [ ] `v2/src/execution/write-loop.test.ts`: the ready-repair prompt renders `ALLOWED_PATHS` equal to `resolveAttributableRepairAllowset(frozen, error)` in both branches (marker-attributed subset; frozen fallback); fails when the placeholder is empty or the frozen set is rendered for a marker-attributed failure.
- [ ] `v2/src/execution/write-loop.test.ts`: the `ready_gate_repair` event carries `failingStep` and a `gateOutputTail` ending with the gate output's last line and capped at 4 KiB.
- [ ] `bun run typecheck`, `bun run test:shared`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/prompts.md` — add `ALLOWED_PATHS` to the `write.ready-repair` row.
- `v2/docs/workflow-runner.md § Ready gate repair` — note the agent receives the attributable allowset and the event's new fields.
- `v2/docs/coding-standards.md` — show the new guard message.
