# 01 - Document iteration timeout rollover and terminal stall

## Problem

Operator docs still describe every wall/ceiling watchdog loss as a terminal failed `iteration_timeout` with inventory-gated `loop_finished.resumable`, with no mention of in-loop rollover on checkpointed live-output timeouts; `docs/operator-runbook.md` still tells operators that timeouts without completed subspecs are non-resumable and to re-dispatch the workflow instead of `jarvis run resume`.

## Decisions

- Align `docs/write-behavior.md` controlled-loss / watchdog section with rollover (`iteration_timeout_continued`, cap slot consumption, harness session rollover line) vs terminal stall (`iteration_timeout`, unconditional `loop_finished.resumable: true`); rules out leaving inventory gating documented as the resumability contract for terminal wall timeouts.
- Align `docs/workflow-runner.md` iteration-timeout paragraph with the same split; rules out contradicting write-behavior on resume semantics.
- Align `docs/operator-runbook.md` recovery copy for `iteration_timeout` (completed-subspec section, inventory-gated non-resumability, and known-gotcha `resume` vs re-run bullets) with rollover and unconditional terminal-stall `jarvis run resume`; rules out runbook contradicting harness settlement after subspec 00.
- Update `docs/v1-behaviors.md` harness write-loop iteration-timeout bullets to catalog rollover and unconditional terminal-stall resumability; rules out behavior-catalog drift.

## Task checklist

- [ ] Edit `docs/write-behavior.md` watchdog settlement prose for rollover vs terminal stall, cap behavior, and resumable terminal stall.
- [ ] Edit `docs/workflow-runner.md` iteration timeout paragraph.
- [ ] Edit `docs/operator-runbook.md` `iteration_timeout` recovery and conflicting gotcha bullets.
- [ ] Edit `docs/v1-behaviors.md` iteration-timeout behavior entries.

## Acceptance criteria

- [ ] `docs/write-behavior.md` states that wall/ceiling timeout after quiescence may commit non-terminal `iteration_timeout_continued` and continue the loop when live output and a fresh checkpoint commit exist, otherwise terminal `iteration_timeout` with `loop_finished.resumable: true` unconditionally.
- [ ] `docs/workflow-runner.md` matches that contract without inventory-gated resumability for terminal wall timeouts.
- [ ] `docs/operator-runbook.md` describes rollover vs terminal stall consistently with write-behavior and directs `jarvis run resume` for terminal wall timeouts (not inventory-gated non-resumability or workflow re-dispatch as the default recovery).
- [ ] `docs/v1-behaviors.md` records the harness behavior change.

## Documentation updates

- `docs/write-behavior.md`
- `docs/workflow-runner.md`
- `docs/operator-runbook.md`
- `docs/v1-behaviors.md`
