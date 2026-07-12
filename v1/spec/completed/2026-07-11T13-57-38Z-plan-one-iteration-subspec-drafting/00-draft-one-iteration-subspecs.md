# 00 - Draft one-iteration subspecs

## Problem

Drafting can combine independent implementation paths into a subspec that exceeds one normal patch iteration.

## Decisions

- Size a subspec as one implementation path with focused verification, not bundled independently implementable builder, wiring, or validation paths.
- Keep coupled changes in one subspec, not split a single implementation path merely to make smaller files.
- Use qualitative sizing, not numeric thresholds; a normal patch iteration is the governing judgment.
- Deferred to first consumer: deterministic size thresholds — pin when a non-judgmental reviewer needs them.

## Tasks

- Update the draft prompt and its revision-keyed rendered fixture.
- Add focused prompt assertions.
- Update the operator behavior and sourced parity record.

## Documentation updates

- Update `v1/docs/plan-mode.md` as the operator-behavior authority.
- Update `v2/docs/v1-behaviors.md` with a sourced parity entry, not duplicate normative guidance.

## Acceptance criteria

- [x] Plan drafting directs the agent to create one-iteration subspecs: one implementation path, focused verification, and no bundled independently implementable builder, wiring, or validation path; coupled changes remain together.
- [x] Draft prompt rendering and focused plan-prompt tests cover the one-implementation-path sizing instruction.
- [x] `v1/docs/plan-mode.md` is the sizing behavior authority; `v2/docs/v1-behaviors.md` records its source without duplicating the guidance.
- [x] `bun run typecheck`, `bun run test:v1`, `bun run test:v2`, and `bun run test:integration:v2` pass.
