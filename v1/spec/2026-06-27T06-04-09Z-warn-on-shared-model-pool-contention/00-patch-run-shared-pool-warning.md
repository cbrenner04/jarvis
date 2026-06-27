# Patch run shared-pool warning

Patch run start should make Claude-pool contention visible before the first actuator invocation. When the resolved selected patch actuator primary uses the same Claude pool as a live Jarvis-owned operator/orchestration Claude session, Jarvis emits one non-blocking harness warning so the operator can pause the competing session.

## Decisions

- Detect contention against the selected patch actuator primary after tier, floor, and override resolution; rules out warning on unused fallback rungs.
- Scope contention to live Jarvis-owned operator/orchestration Claude sessions; rules out warning on unrelated generic Claude processes.
- Use a best-effort live-process probe for Jarvis-owned Claude operator/orchestration sessions; rules out waiting for quota/cascade evidence, which warns too late.
- Warning failures are silent and non-blocking; rules out treating process-probe errors as preflight failures.
- Deferred to first consumer: non-Claude shared-pool mappings — pin when a caller needs it.

## Tasks

- [x] Add run-start contention detection for the resolved selected patch actuator primary.
- [x] Emit one harness warning when a live Jarvis-owned operator/orchestration Claude session shares the Claude pool.
- [x] Keep agent selection, quota fallback, no-progress escalation, and exit behavior unchanged.
- [x] Add focused tests for warning, no-warning, and probe-failure cases.
- [x] Update durable docs for the new operator-visible warning behavior.

## Acceptance criteria

- [x] Starting `jarvis1 run` with a resolved Claude-pool patch primary and one or more detected live Jarvis-owned operator/orchestration Claude sessions prints one harness warning before the first patch actuator invocation.
- [x] The warning says the selected patch primary shares the Claude pool with a live operator/orchestration session and that the operator can pause the competing session.
- [x] The run prints no additional shared-pool warnings for extra matching sessions or later fallback/no-progress iterations.
- [x] The warning is non-blocking: the run still invokes the same resolved primary agent first and keeps existing quota/no-progress fallback behavior.
- [x] No warning is printed for unrelated generic Claude processes that are not Jarvis-owned operator/orchestration sessions.
- [x] Tier, floor, or override resolution that selects a non-Claude-pool primary prints no warning even when the raw first configured rung uses the Claude pool.
- [x] No warning is printed when the selected patch actuator primary does not use the Claude pool, even if later fallback entries do.
- [x] A process-probe failure does not fail preflight or suppress the run.
- [x] `v1/docs/run-loop.md` documents the warning and its non-blocking behavior.
- [x] `v1/docs/operator-runbook.md` documents the warning and operator response.
- [x] `v2/docs/v1-behaviors.md` records the v1 behavior with source citations.
- [x] `bun run typecheck` passes.
- [x] `bun run test` passes.

## Documentation updates

- Update `v1/docs/run-loop.md` under patch run/model selection behavior.
- Update `v1/docs/operator-runbook.md` with the warning and pause-competing-session guidance.
- Update `v2/docs/v1-behaviors.md` because this changes v1 operator-facing behavior.
