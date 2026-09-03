# Document v1-behaviors admission parity

## Problem

`v1-behaviors.md` records v1 external seed validation for no-commit intent mode and v2 committed routing, but not v2 admission of externally queued seeds and ready-intents or v2 plan commit-decision parity with intent.

## Prerequisites

- `04-document-operator-admission-paths` (operator paths documented first).

## Decision ledger

- Record v2 additive bullets for external seed admission, external ready-intent admission, and plan `modes.plan.commit` parity; rules out silently changing the v1 baseline prose.
- Cite `publication-workflow-steps.ts` and the pinning tests from `00`–`02`; rules out unsourced parity claims.
- Note v1 already validates external seeds for no-commit intent; v2 extends admission to the publication builder seam; rules out claiming v1 lacked external seed paths entirely.
- v2 plan external ready-intent admission restores v1 absolute-path behavior at the publication builder seam; rules out framing it as net-new v1 capability.

## Tasks

- Add `[v2 additive]` entries to `v1-behaviors.md` for external seed admission, external ready-intent admission (restoring v1 absolute-path behavior at the publication builder), and plan commit-decision parity with intent.
- Source each bullet to `publication-workflow-steps.ts` and the regression tests from `00`–`02`.

## Acceptance criteria

- [ ] `v2/docs/v1-behaviors.md` records v2 external seed admission, v2 plan external ready-intent admission (restoring v1 absolute-path behavior at the publication builder, not net-new v1 capability), and plan commit-decision parity against v1, consistent with `00`–`02`.

## Documentation updates

- None beyond the acceptance criterion above.
