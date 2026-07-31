---
name: intent-landing-contracts-reprompt-before-settle
---

# Intent landing contracts reprompt before they settle

## Problem

Intent landing validates staged ready-intents against shape contracts. Violations settle
`landing_failed` after the write agent is gone; recovery is hand-editing `.jarvis-intent-stage/`
and `jarvis run resume`. The harness already reprompts on `missing_blocker`; landing contracts
get no such loop.

Splitting does not apply: landing validation, write-loop reprompt, filename normalization, and
intent write-step prompt injection all sit on the execution-loop surface.

## Decisions

- Landing-contract violation reprompts the write agent with violation text and offending file within the existing iteration budget — rules out settling `landing_failed` on first violation.
- Only after the reprompt budget is spent does the run settle `landing_failed` with stage contents intact and `resumable: true` / `nextAction: "resume"` — rules out removing the operator resume path.
- Emitted-filename and prerequisites contracts are stated in injected intent write-step rules — rules out recovery-only changes with a silent prompt.
- `NN-` ordering prefixes on emitted ready-intent filenames are normalized by the harness — rules out reprompting or silently rewriting prose that requires judgment.
- Out of scope: changing the contracts themselves — rules out revising one-bullet-per-line or no-ordering-prefix rules.

## Acceptance criteria

- [ ] An intent landing that violates the prerequisites one-bullet-per-line contract reprompts the write agent with the violation message and the offending file rather than settling; a test pins the reprompt and fails against the pre-fix code (which settles `landing_failed` immediately).
- [ ] After the reprompt budget is exhausted with the violation unfixed, the run settles `landing_failed` with today's `resumable: true` / `nextAction: "resume"` and the stage contents intact; a regression covers it.
- [ ] An emitted ready-intent filename carrying an `NN-` ordering prefix is normalized by the harness to the unprefixed name and lands without a reprompt; a test pins the landed name and fails against the pre-fix code.
- [ ] The injected intent write-step rules state the emitted-filename and prerequisites contracts; a rendered-prompt test pins both.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — landing contracts reprompt before they settle; which are normalized and which reprompt.
- `v2/docs/operator-runbook.md` § Intent finalization failed with staged files remaining — settled `landing_failed` means the reprompt budget was already spent.
- `v2/docs/v1-behaviors.md` — record the changed intent landing failure behavior.

## Prerequisites

- `landIntentWorkflowOutput` validates staged ready-intents and settles `landing_failed` on shape violation.
- Write steps reprompt the agent on `missing_blocker` before settling.
- Intent write-step rules are injected from rendered prompts with existing prompt tests.
