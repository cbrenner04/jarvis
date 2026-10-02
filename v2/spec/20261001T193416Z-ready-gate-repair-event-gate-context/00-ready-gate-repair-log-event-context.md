# 00 — Extend `ready_gate_repair` log event with step context

## Problem

`ready_gate_repair` on the run log carries only `attempt` and `gateExitCode`, so `jarvis run log` cannot show which ready step failed or the bounded output the repair path uses.

## Decisions

- Add required `failingStep: string` and `gateOutputTail: string` on `ReadyGateRepairEvent` in `log-stream.ts`; rules out a sibling event kind or deferring context to `loop_finished` only.
- Append both fields at the existing `ready_gate_repair` site in `publishWithReadyRepair` before `runReadyRepairIteration`; rules out emitting after the repair agent runs (stale gate context on later attempts).
- Set `failingStep` and step-scoped output via `selectFailedReadyStepOutput(gateError.command, gateError.output)` — the same selector that fills `GATE_STEP` / step-scoped `GATE_OUTPUT` for `write.ready-repair`; rules out log fields that disagree with the repair prompt.
- Set `gateOutputTail` to the last 4096 bytes of that step-scoped `output` (same byte cap as private `AUTOFIX_TYPECHECK_OUTPUT_TAIL_MAX` in `write-loop.ts`, not `READY_GATE_OUTPUT_MAX_CHARS`); rules out whole-gate tails or the 16 KiB prompt cap on the log event.
- New focused regression in `v2/src/execution/write-loop-ready-repair.test.ts`; update exact-shape pins in `write-loop.test.ts` and `workflow-runner-publication.test.ts` in the same subspec; rules out leaving two-field `toEqual` / `toContainEqual` pins that hide regressions.

## Tasks

- [ ] Extend `ReadyGateRepairEvent` and emit `failingStep` + `gateOutputTail` from `publishWithReadyRepair`.
- [ ] Add `write-loop-ready-repair.test.ts` (step-marker log layout, tail ends on the failing step's last line, 4 KiB cap case).
- [ ] Refresh `ready_gate_repair` shape assertions in `write-loop.test.ts` and `workflow-runner-publication.test.ts`.
- [ ] Document the new fields in `workflow-runner.md` § Ready gate repair.

## Acceptance criteria

- [x] `v2/src/execution/write-loop-ready-repair.test.ts`: the first `ready_gate_repair` event includes `failingStep` matching the terminal failed step command and a `gateOutputTail` whose last line matches that step's output last line, with length ≤ 4096 when step output exceeds the cap; fails against the pre-fix two-field event.
- [x] `v2/src/execution/write-loop.test.ts` and `v2/src/execution/workflow-runner-publication.test.ts`: every pinned `ready_gate_repair` object includes `failingStep` and `gateOutputTail`; fails against pre-fix two-field assertions.
- [x] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` § Ready gate repair — `ready_gate_repair` log events include `failingStep` (same value as repair prompt `GATE_STEP`) and `gateOutputTail` (last 4 KiB of that step's output).
- `v2/docs/v1-behaviors.md` — **[v2 additive]** note the extended `ready_gate_repair` run-log fields beside the existing ready-gate repair prompt scoping entry.
