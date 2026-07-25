---
name: snapshot-continue-resolves-current-agent-binding
---

# A run continuing from a persisted write snapshot resolves agent binding from current machine profile

A persisted write snapshot records the binding from the attempt that created it. Resume,
re-dispatch (`--reset-despite-dirty`), and `role_timeout` recovery all reuse that checkpoint,
so a rung edit made to fix the failure being retried silently does not apply today. New
admissions on the same daemon already pick up the new rung — the bug is per-run replay, not
stale daemon config.

## Decisions

- Snapshot continuation re-resolves agent binding from current machine profile for the step role; rules out silent replay of the snapshot-recorded binding.
- `--reset-despite-dirty` does not preserve a stale persisted binding: workspace reset and binding resolution both start from current profile; rules out a “clean slate” flag that still replays haiku.
- Deferred to first consumer: explicit opt-out to replay snapshot binding for reproducibility — pin when a caller needs it.
- No binding-replay path ships in this change; divergence-on-row for replay is owned by run-list visibility, not a second replay mode.
- `role_timeout` recovery shares the snapshot continuation / re-dispatch path with resume and `--reset-despite-dirty`; AC3’s re-resolve guard covers it.
- Out of scope: `~/.jarvis/config.json` `agents` / `machineProfile` selection — check whether it shares replay behavior when a later caller needs it.

## Acceptance criteria

- [ ] A run resumed or re-dispatched from a persisted write snapshot after a machine-profile rung edit uses the new rung on the retry; a test edits the profile between first attempt and retry, asserts the new `adapterModel`, and fails against pre-fix replay.
- [ ] A newly admitted run on a running daemon still resolves the current rung without daemon restart; the regression test fails if continuation fix regresses admission.
- [ ] No snapshot resume or re-dispatch path invokes from a persisted binding without re-resolving against current machine profile; inverting the re-resolve guard fails the test.

## Documentation updates

- `v2/docs/v1-behaviors.md` — snapshot continuation re-resolves binding from current profile (not persisted snapshot binding).
- `v2/docs/agent-model-config.md` — when a rung edit takes effect for new admissions vs snapshot continuation after this change.
- `v2/docs/operator-runbook.md` — re-dispatch and resume pick up rung edits; how to confirm via telemetry until list shows binding.

## Prerequisites

- A persisted write-step snapshot backs daemon resume and re-dispatch for workflow write runs.
- Machine-profile rungs are resolved per role at invocation admission for newly admitted runs.
