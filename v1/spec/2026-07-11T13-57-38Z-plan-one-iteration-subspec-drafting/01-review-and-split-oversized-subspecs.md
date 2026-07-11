# 01 - Review and split oversized subspecs

## Problem

Review can leave an oversized subspec intact by compressing its prose instead of separating independent paths.

## Decisions

- Review explicitly detects a subspec exceeding one implementation path with focused verification, not ambiguous general review wording.
- An oversized verdict requires an adjudicated split outcome, not prose compression.
- Split replacements preserve scope: each original task and acceptance outcome appears exactly once, not duplicated, omitted, or orphaned.
- The actuator keeps the index routable by linking every replacement, not an unlinked subspec tree.
- Deferred to first consumer: deterministic size thresholds — pin when a non-judgmental reviewer needs them.

## Tasks

- Update review-role and actuator prompts with the one-iteration sizing check.
- Add an end-to-end actuator guard for an oversized verdict and split tree.
- Update revision-keyed rendered fixtures and focused prompt assertions.
- Update the operator behavior and sourced parity record.

## Documentation updates

- Update `v1/docs/plan-mode.md` as the operator-behavior authority.
- Update `v2/docs/v1-behaviors.md` with a sourced parity entry, not duplicate normative guidance.

## Acceptance criteria

- [ ] Plan self-review explicitly identifies an oversized subspec and requires an adjudicated independently testable split rather than prose compression.
- [ ] An oversized-split outcome preserves scope: every original task and acceptance outcome appears exactly once across replacements, with no orphaned work, and the routable index links every replacement.
- [ ] An end-to-end actuator guard proves an oversized verdict produces the valid split tree without expanding implementation scope.
- [ ] Review and actuator prompt rendering plus focused plan-prompt tests cover the sizing check and adjudicated split outcome.
- [ ] `v1/docs/plan-mode.md` is the self-review behavior authority; `v2/docs/v1-behaviors.md` records its source without duplicating the guidance.
- [ ] `bun run typecheck`, `bun run test:v1`, `bun run test:v2`, and `bun run test:integration:v2` pass.
