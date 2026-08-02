# State human-only markers in plan guidance

## Prerequisites

- `isHumanOnlyCriterion` classifies marker text with case-insensitive substring matching anywhere
  in the assembled criterion block (e.g. `no automated guardrails` qualifies). Parser behavior is
  unchanged in this subspec.

## Problem

`v1/docs/spec-guidance.md` still describes trailing markers although the parser classifies marker
text case-insensitively anywhere in an acceptance criterion's full bullet block. In particular,
the existing substring rule also classifies `no automated guardrails`; this subspec documents that
existing behavior rather than changing parser semantics.

## Decisions

- State `(Manual)`, `visual inspection only`, and `no automated guard` as the accepted marker text;
  matching is case-insensitive substring matching, not a whole-phrase boundary rule.
- State that marker text may appear anywhere in the first checklist line or continuation lines of
  the full criterion block — rules out first-line and trailing anchoring.
- Cover the v2 `plan.prompt.draft` rendering and the v1 plan draft and review renderers separately.
  The v1 doc is injected directly by `draft.ts` and `review.ts`, so v2 coverage cannot stand in for it.
- Keep parser behavior and marker vocabulary unchanged; no guard-inversion checkpoint is owed for
  this documentation and test-only change.

## Tasks

- Replace the trailing-anchor wording in `v1/docs/spec-guidance.md` with the marker text,
  case-insensitive substring behavior, full-bullet scope, and free placement.
- Add focused v2 and v1 rendered-prompt checks that isolate the bundled `SPEC_GUIDANCE` injection.
- Refresh affected v1 plan rendered fixtures.

## Acceptance criteria

- [ ] A rendered `plan.prompt.draft` case in `v2/src/execution/write.test.ts` fails against the
      pre-change bundled spec guidance and passes after the isolated `SPEC_GUIDANCE` section names
      `(Manual)`, `visual inspection only`, and `no automated guard`, says matching is
      case-insensitive substring matching, and permits each anywhere in the full bullet block. The
      test uses a marker-free sentinel for the separate `STEP_RULES` injection, so a whole-prompt
      assertion cannot obtain the contract from another source.
- [ ] Focused v1 plan draft and review rendered cases in `v1/test/modes/plan/prompts.test.ts` fail
      against the pre-change bundled guidance and independently pin the same isolated guidance
      contract; they do not rely on the v2 shared-plan rendering.
- [ ] `v1/docs/spec-guidance.md` describes plan guidance consistent with the parser's existing
      full-bullet, case-insensitive substring classification, including free marker placement.

## Documentation updates

- `v1/docs/spec-guidance.md` — accepted marker text, substring recognition, and free placement in
  the full criterion block.
