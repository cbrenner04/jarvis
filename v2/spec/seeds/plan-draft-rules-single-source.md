---
name: plan-draft-rules-single-source
---

# State each plan authoring rule once: dedupe draft-prompt rules against injected guidance

## Problem

`prompts/plan/draft.md`'s Rules section (15 bullets) restates content that the same prompt already injects via `SPEC_GUIDANCE`: the failing-test requirement, the guard-inversion requirement, and the agent-verifiable-AC rules each appear in both the prompt body and `v1/docs/spec-guidance.md`, worded differently. `prompts/plan/review-actuator.md` repeats the structural-vs-behavioral AC rewrite rule the same way. Two divergent copies of a normative rule is a correctness risk (the agent must reconcile them), not just doubled tokens, and every edit now has to land twice.

## Decisions

- Each authoring rule lives once, in the injected agent-core guidance; prompt Rules sections keep only step mechanics (write boundaries, no commit/push, no tests, blocker contract, frontmatter preservation). Rules out two divergent normative copies.
- Sequenced after the agent-core/operator guidance split so the single home already exists. Rules out deduping into a file that is about to be split.
- Where the prompt copy and the guidance copy currently disagree in wording, the guidance wording wins and the delta is inventoried in the spec. Rules out silently picking whichever copy was edited last.

## Acceptance criteria

- [ ] The assembled plan-draft prompt contains the failing-test requirement exactly once, pinned by a render test counting the contract phrase.
- [ ] The same single-occurrence pin holds for the guard-inversion and agent-verifiable-AC rules.
- [ ] Plan-draft normalizer and validator behavior is unchanged, pinned by existing plan workflow tests staying green.
- [ ] `bun run typecheck`, `bun run test:v1`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/prompts.md` — note that draft/actuator Rules carry step mechanics only, with authoring rules owned by the injected guidance.
