# Document plan boundary split

Record the plan-step split contract where operators and spec authors already look for workflow and
subspec sizing rules.

## Decisions

- Durable homes are `v2/docs/workflow-runner.md` and `v1/docs/spec-guidance.md` per the intent — rules out duplicating the full surface list in prompt-only comments.
- `v2/docs/v1-behaviors.md` draft-validation bullet gains the normalization step in validation order — rules out leaving the v1 parity catalog stale after harness behavior changes.

## Tasks

- Document that the plan draft step splits multi-boundary drafted subspecs (AC-owned boundaries only) into one emitted subspec per boundary before validation/publish.
- Document that each subspec should own one module boundary, using the same surface definition as intent split.
- Update the v1-behaviors draft-validation order to mention boundary normalization before structural per-subspec checks.

## Acceptance criteria

- [ ] `v2/docs/workflow-runner.md` states that multi-boundary drafted subspecs are split on emit rather than published whole, and names acceptance criteria as the oversize signal.
- [ ] `v1/docs/spec-guidance.md` states that a subspec owns one module boundary (intent-split surface definition).
- [ ] `v2/docs/v1-behaviors.md` records boundary-split normalization in the plan draft validation order.

## Documentation updates

- `v2/docs/workflow-runner.md` — plan step splits multi-boundary drafted subspecs rather than emitting them whole.
- `v1/docs/spec-guidance.md` — subspec owns one module boundary (same surfaces as intent split).
- `v2/docs/v1-behaviors.md` — draft validation order includes boundary-split normalization.
