# 00 — Repair prompt scoped to the failing gate step

## Problem

`v2/src/execution/write-loop.ts` fills `write.ready-repair`'s `GATE_OUTPUT` with the whole gate log tail (`gateError.output.slice(-READY_GATE_OUTPUT_MAX_CHARS)`), so repair sees passing steps' warnings and edits out-of-diff files instead of fixing the red step (#3951: `guard-dead-exports` on an in-diff file).

`scripts/ready.ts` runs each step with `stdio: "inherit"` (step output on stdout) and writes step-start lines, heartbeats and `JARVIS_READY_STEP_COMPLETED` records to stderr; `createDefaultRunReadyGate` builds the log as `${stdout}${stderr}`. Step output therefore precedes every completion record, so completion records alone cannot bracket a step's output.

## Decisions

- `scripts/ready.ts` writes a `JARVIS_READY_STEP_STARTED {stepId, attemptId, command}` record to both stdout and stderr immediately before each attempt spawns. Rules out completion-record slicing (stdout output precedes all stderr records) and a merged-stream gate-runner change (child output is inherited, not piped through the runner).
- The record is written synchronously to fd 1 and fd 2, after a leading `\n`, so it lands in order with the child's inherited output and starts its own line (`parseMarkerRecords` is line-based).
- A step's output = every log segment starting at a `JARVIS_READY_STEP_STARTED` line whose `stepId` matches the failing step, up to the next start record of any step or the end of the log; segments concatenated in log order. Covers both streams and both attempts of a retried test step; rules out a separate same-`stepId` retry rule.
- Failing step = terminal non-zero `JARVIS_READY_STEP_COMPLETED` record, any command. `selectTerminalFailedReadyStep` and `selectTerminalFailedReadyTestStep` are refactored to filter the same unfiltered terminal-failed helper by command, so the parsers cannot drift; their existing tests stay green.
- Prompt names the failing step's `command` via a new required `GATE_STEP` placeholder in `prompts/write/ready-repair.md` (bump `revision`); `GATE_COMMAND` stays the whole gate command.
- Fallback to the whole-log tail with `GATE_STEP` = gate command whenever there is no non-zero completion record (custom `readyCommand`, timeout or crash mid-step) or no start record for the failing `stepId`. Rules out failing repair or an empty `GATE_OUTPUT`.
- `READY_GATE_OUTPUT_MAX_CHARS` tail cap applies to the selected step output, not the whole log.
- Selector is a pure exported function in `v2/src/execution/ready-finalize.ts` beside the existing marker parsers.

## Tasks

- [ ] Emit the step-start record from `scripts/ready.ts`.
- [ ] Add the step-output selector (sharing the terminal-failed helper); wire it into the repair prompt placeholders.
- [ ] Add `GATE_STEP` to `write.ready-repair`; map `prompts/write/ready-repair.md` → `v2/src/execution/write.test.ts` in `shared/prompts/render-observer-tests.ts` (currently unmapped, so the mutation verifier would settle `missing-render-coverage`) and extend that test's `write.ready-repair` case.
- [ ] Update docs.

## Acceptance criteria

- [ ] A test in `scripts/ready.test.ts` runs the gate loop with a fake step runner and asserts a `JARVIS_READY_STEP_STARTED` record with the step's `stepId`, `attemptId` and `command` precedes each attempt (including a retry) on both stdout and stderr; it fails against the pre-fix `scripts/ready.ts`.
- [ ] A test in `v2/src/execution/ready-finalize.test.ts` builds the log as `${stdout}${stderr}` (step output and start records on stdout; start/heartbeat/completion records on stderr), with a passing step carrying warning text followed by a failing `bun run check` step, and asserts the selector returns the failing command and only that step's output; it fails against the pre-fix whole-log behavior.
- [ ] A selector test with a retried failing test step asserts both attempts' output is returned.
- [ ] A selector test with a log that has completion records but none non-zero (and one with no records) asserts the whole-log tail fallback and gate command as `GATE_STEP`.
- [ ] A selector/write-loop test asserts `READY_GATE_OUTPUT_MAX_CHARS` truncates the failing step's own output (tail kept), not the whole log; it fails against the pre-fix whole-log slice.
- [ ] A write-loop repair test, using the `${stdout}${stderr}` log layout, asserts the rendered `write.ready-repair` prompt contains the failing step's command and output and excludes the passing step's output; it fails against the pre-fix whole-log prompt.
- [ ] `RENDER_OBSERVER_TESTS` maps `prompts/write/ready-repair.md` to `v2/src/execution/write.test.ts`, whose `write.ready-repair` case renders the real registered template with a `GATE_STEP` value and asserts the rendered prompt contains it; it fails against the pre-fix template.
- [ ] The existing write-loop ready-repair tests that use a log without step records (custom-command gate) stay green (fallback preserves behavior), as do the existing `selectTerminalFailedReadyStep` and `selectTerminalFailedReadyTestStep` tests in `v2/src/execution/ready-finalize.test.ts`.
- [ ] `bun run typecheck`, `bun run test:v2` and `bun run test:integration:v2` pass, plus full `bun run test` (root tooling `scripts/ready.ts` and `shared/**` touched).

## Documentation updates

- `v2/docs/operator-runbook.md` — ready-gate section: document the `JARVIS_READY_STEP_STARTED` record beside the completion record; ready-gate repair entry (Autofix, bounded repair, and settlement): repair prompt carries only the failing step's command and output; whole-log fallback without a non-zero completion record.
- `v2/docs/v1-behaviors.md` — record the ready-gate repair prompt scoping.
