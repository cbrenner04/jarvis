# Patch run shared-pool warning

Patch run start should make Claude-pool contention visible before the first actuator invocation. When the selected patch actuator primary uses the same Claude pool as a live operator/orchestration session, Jarvis emits a non-blocking harness warning so the operator can pause the competing session.

## Decisions

- Detect contention against the selected patch actuator primary after tier, floor, and override resolution; rules out warning on unused fallback rungs.
- Use a best-effort live-process probe for Claude operator/orchestration sessions; rules out waiting for quota/cascade evidence, which warns too late.
- Warning failures are silent and non-blocking; rules out treating process-probe errors as preflight failures.
- Deferred to first consumer: non-Claude shared-pool mappings — pin when a caller needs it.

## Tasks

- [ ] Add run-start contention detection for the selected patch actuator primary.
- [ ] Emit one harness warning when a live operator/orchestration session shares the Claude pool.
- [ ] Keep agent selection, quota fallback, no-progress escalation, and exit behavior unchanged.
- [ ] Add focused tests for warning, no-warning, and probe-failure cases.
- [ ] Update durable docs for the new operator-visible warning behavior.

## Acceptance criteria

- [ ] Starting `jarvis1 run` with a Claude-pool patch primary and a detected live Claude operator/orchestration session prints a harness warning before the first patch actuator invocation.
- [ ] The warning is non-blocking: the run still invokes the same primary agent first and keeps existing quota/no-progress fallback behavior.
- [ ] No warning is printed when the selected patch actuator primary does not use the Claude pool, even if later fallback entries do.
- [ ] A process-probe failure does not fail preflight or suppress the run.
- [ ] `v1/docs/run-loop.md` documents the warning and its non-blocking behavior.
- [ ] `v2/docs/v1-behaviors.md` records the v1 behavior with source citations.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test` passes.

## Documentation updates

- Update `v1/docs/run-loop.md` under patch run/model selection behavior.
- Update `v2/docs/v1-behaviors.md` because this changes v1 operator-facing behavior.
