# `intent-reviewed` workflow — split + light review

Extend intent operator path: after split, run one `review` step (critic +
actuator) over staged ready-intents before landing to `ready-intents/`.

## Scope

- Governed prompts: `intent.prompt.review` (critic), `intent.prompt.review-actuator`
  (actuator context); register in `prompts/` + governance doc.
- Preset `intent-reviewed`: `write` (split) → `review` (`maxCycles` from
  `--review-passes`, default 1).
- Builder flag `--review-passes 0` selects preset `intent` (split only) or
  omits review step — same builder, explicit passes.
- Verdict path beside staging dir (e.g. `verdict-intent.md`).
- Register on workflow launcher.

## Decisions

- Light review only — not `review-debate` on ready-intents.
- Default v2 posture for intent is `intent-reviewed`; `intent` remains v1
  parity.

## Prerequisites

- `review` behavior merged (seed 00).
- `intent` split workflow merged (seed 02).
- Workflow loader attaches bindings to `review` steps (seed 06) — may land in
  same PR if 06 is not merged yet; spec must state dependency.

## Out of scope

- Human gate after intent review.
- Plan workflow.

## Reference

- `.scratch/v2-operator-workflows.md` — §`intent`, seeds 03, R4–R5

## Documentation updates

- `v1/docs/prompt-governance.md` — new intent review prompt IDs
- Intent workflow operator doc — `intent` vs `intent-reviewed`
