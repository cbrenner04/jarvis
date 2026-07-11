# 00 - Draft one-iteration subspecs

## Problem

Drafting can combine independent implementation paths into a subspec that exceeds one normal patch iteration.

## Decisions

- Draft one implementation path with focused verification per subspec, not builder, runtime wiring, and validation together.
- Split independent paths into independently testable linked subspecs, not one precise monolith.
- Deferred to first consumer: deterministic size thresholds — pin when a non-judgmental reviewer needs them.

## Tasks

- Update the draft prompt and its revision-keyed rendered fixture.
- Add focused prompt assertions.
- Update durable plan drafting behavior docs.

## Documentation updates

- Update `v1/docs/plan-mode.md` for draft sizing.
- Update `v2/docs/v1-behaviors.md` with sources.

## Acceptance criteria

- [ ] Plan drafting directs the agent to split independent implementation paths into atomic subspecs that each fit one normal patch iteration.
- [ ] Draft prompt rendering and focused plan-prompt tests cover the one-implementation-path sizing instruction.
- [ ] `v1/docs/plan-mode.md` and `v2/docs/v1-behaviors.md` describe the draft sizing behavior with governing sources.
- [ ] `bun run typecheck`, `bun run test:v1`, `bun run test:v2`, and `bun run test:integration:v2` pass.
