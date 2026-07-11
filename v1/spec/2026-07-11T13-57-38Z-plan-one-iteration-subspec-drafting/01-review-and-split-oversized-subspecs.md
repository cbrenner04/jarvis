# 01 - Review and split oversized subspecs

## Problem

Review can leave an oversized subspec intact by compressing its prose instead of separating independent paths.

## Decisions

- Review flags and splits a subspec unlikely to finish in one normal patch iteration, not merely compressing its prose.
- The review verdict requires an outcome-level split and the actuator applies it to the index and subspec tree, not a prescribed file layout.
- Deferred to first consumer: deterministic size thresholds — pin when a non-judgmental reviewer needs them.

## Tasks

- Update review-role and actuator prompts with the one-iteration sizing check.
- Update revision-keyed rendered fixtures and focused prompt assertions.
- Update durable self-review behavior docs.

## Documentation updates

- Update `v1/docs/plan-mode.md` for self-review sizing.
- Update `v2/docs/v1-behaviors.md` with sources.

## Acceptance criteria

- [ ] Plan self-review identifies a subspec unlikely to finish in one normal patch iteration and requires independently testable splits rather than prose compression.
- [ ] A review actuator receiving that verdict splits the linked spec tree without expanding its implementation scope.
- [ ] Review and actuator prompt rendering plus focused plan-prompt tests cover the sizing check and split outcome.
- [ ] `v1/docs/plan-mode.md` and `v2/docs/v1-behaviors.md` describe the self-review sizing behavior with governing sources.
- [ ] `bun run typecheck`, `bun run test:v1`, `bun run test:v2`, and `bun run test:integration:v2` pass.
