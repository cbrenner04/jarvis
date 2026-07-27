# Re-resolve binding on snapshot continuation

Persisted workflow write snapshots still record `agentModelConfig` from the attempt
that wrote them. `reconstructWriteResume` passes that copy into
`bindingResolution`, so snapshot-backed write continuation replays stale rungs after
a machine-profile edit. Fresh write admission already loads the current profile;
the gap is per-run replay on continuation and queue promotion.

## Decisions

- Continuation **execution** resolves bindings from the current machine profile via the same loader path as fresh write-step admission, then `resolveWriteLoopBindings` for the step role; rules out passing snapshot `step.agentModelConfig` into `bindingResolution`. On-disk snapshot `agentModelConfig` may stay historical until a later change updates it — operators confirm the active rung from attempt telemetry until `run list` agent/model columns ship (`v2/spec/tui-overhaul-brief.md`).
- **Current machine profile** means the same resolution as fresh admission: committed profile file for the active `machineProfile` key in `~/.jarvis/config.json`, not only an in-file rung edit with an unchanged profile key.
- Continuation keeps snapshot `step.agents` as the outer-loop scope; rules out re-reading `~/.jarvis/config.json` agent order in this change.
- Re-resolve keeps today's shrink role mapping when loading rungs (hidden shrink step id → `shrink` role, same as `reconstructWriteResume` / `resolveExecutableRole`).
- **Choke points** (audit aligns all; no documented replay exceptions): `reconstructWriteResume` before `resolveWriteLoopBindings`; queued-run promotion (`promoteQueuedRunImpl` → `resolveWriteLoopBindings(run.queuedInput)`); daemon `start` write-loop admission; CLI write/resume paths that call `resolveWriteLoopBindings`. Audit outcome is alignment only — no allowlist of snapshot-replay exceptions.
- **`jarvis run resume`**, daemon `resume`, and startup `recoverReconciledRuns` (auto-resume via the resume handler) are the primary continuation proof surface.
- **`--reset-despite-dirty`:** binding proof is continuation/admission-shaped — a successful re-run uses the same `resolveWriteLoopBindings` / fresh write-step admission path as a new step, not necessarily `reconstructWriteResume`. Docs state clean-slate re-dispatch picks up the current rung; optional dedicated workflow re-dispatch integration test only if admission coverage is insufficient.
- **`role_timeout` / `role_stalled` / `retry_later`:** no separate workflow-layer snapshot-binding replay mode; review-phase re-dispatch is out of scope for implement write `adapterModel` re-resolve (does not claim shared binding behavior with resume).
- Deferred to first consumer: explicit opt-out to replay snapshot-recorded binding for reproducibility.
- No binding-replay path ships; run-list agent/model columns are owned by `v2/spec/tui-overhaul-brief.md`.
- Out of scope: whether `~/.jarvis/config.json` `agents` / `machineProfile` selection shares snapshot replay — pin when a later caller needs it.

## Tasks

- Load current profile `AgentModelConfig` at continuation choke points before `resolveWriteLoopBindings`; stop sourcing `bindingResolution.agentModelConfig` from snapshot steps or queue-serialized `queuedInput`.
- Audit the choke points above (including queue promotion); align every `bindingResolution.agentModelConfig` passed into `resolveWriteLoopBindings` with profile load — no intentional replay exceptions.
- Add `daemon-resume.test.ts` coverage for profile rung edit between snapshot write and resume; update resume fixtures that pin snapshot binding replay (e.g. `resume on a killed workflow write run uses the persisted step contract`) so step contract fields stay snapshot-backed while `adapterModel` expectations follow the current profile.
- Add `daemon-reconciliation.test.ts` coverage that `recoverReconciledRuns` auto-resume respawns with bindings from the current profile after a rung edit (real resume handler, not a stub).
- Add `daemon-workflow-start.test.ts` regression: second workflow admission on an already-running daemon after a machine-profile rung edit resolves the new rung without daemon restart (intent AC2).
- Add `daemon-queue-promotion.test.ts` (or extend it) so promotion after a profile edit uses the current rung, not `queuedInput.bindingResolution.agentModelConfig` frozen at queue time.
- Add structural guard test with module allowlist for `bindingResolution.agentModelConfig` sources into `resolveWriteLoopBindings`.
- Update durable docs listed below.

## Acceptance criteria

- [x] `v2/src/daemon/daemon-resume.test.ts` — `test("resume re-resolves write bindings from the current machine profile after a rung edit", …)` drives snapshot-backed resume after a machine-profile rung edit between first attempt and retry, asserts the spawned write loop uses the new `adapterModel`, and fails against pre-fix snapshot replay; updated expectations in `resume on a killed workflow write run uses the persisted step contract` (and any other resume fixtures that pinned snapshot binding replay) stay consistent with current-profile binding.
- [x] `v2/src/daemon/daemon-reconciliation.test.ts` — a regression exercises `recoverReconciledRuns` auto-resume with snapshot-backed write context after a rung edit and asserts the respawned write loop uses the new `adapterModel`; fails against pre-fix replay.
- [x] `v2/src/daemon/daemon-workflow-start.test.ts` — `test("second workflow admission on a live daemon resolves rungs from the edited machine profile", …)` (or equivalent title) admits a second workflow on the same handler instance after a profile rung edit without daemon restart and asserts the new `adapterModel`; fails if continuation fix regresses fresh admission (intent AC2).
- [x] `v2/src/daemon/daemon-queue-promotion.test.ts` (or a sibling guard file) — promotion after a profile edit asserts `adapterModel` from the current profile, not queue-time `queuedInput`; fails against pre-fix replay.
- [x] `v2/src/daemon/write-loop-binding-source-guard.test.ts` (or equivalent) — static allowlist of modules that may pass `bindingResolution.agentModelConfig` into `resolveWriteLoopBindings` (`daemon.ts`, `cli.ts`, and any other call sites found in audit), each required to source config from profile load at continuation choke points; inverting the re-resolve branch (or a dedicated `forceSnapshotAgentModelConfig` test hook beside those call sites) makes the guard fail.
- [x] Listed documentation files no longer imply snapshot JSON is binding truth on continuation: `rg -n 'persisted resolution context|snapshot.*agentModelConfig.*continuation|replay.*snapshot.*binding' v2/docs/v1-behaviors.md v2/docs/agent-model-config.md v2/docs/operator-runbook.md v2/docs/write-behavior.md` finds no matches after the doc pass (update prose so retry/snapshot identity vs live binding is explicit).

## Documentation updates

- `v2/docs/v1-behaviors.md` — snapshot continuation execution re-resolves binding from the current machine profile; persisted snapshot `agentModelConfig` is historical metadata, not operator binding truth.
- `v2/docs/agent-model-config.md` — when a rung edit takes effect for new admissions vs snapshot continuation (resume, re-dispatch after reset, queue promotion); replace “persisted resolution context” wording that implies snapshot-stored rungs on continuation.
- `v2/docs/operator-runbook.md` — resume and re-dispatch pick up rung edits; confirm via attempt telemetry until run list shows binding; do not claim review `retry_later` re-resolves implement write binding.
- `v2/docs/write-behavior.md` — snapshot retry identity vs live binding on continuation (execution uses current profile; on-disk snapshot fields may lag).
