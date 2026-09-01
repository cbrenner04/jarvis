---
name: plan-draft-rules-single-source
---

# State each plan authoring rule once: dedupe draft-prompt rules against injected guidance

Unsplit rationale: Stripping duplicate authoring rules from `plan.prompt.draft` and `plan.prompt.review-actuator`, adding assembled-prompt single-occurrence render pins, and documenting the ownership split are one plan-prompt-corpus contract change; plan-draft normalizer and validator code paths stay untouched.

## Prerequisites

- Plan draft and plan review assembly inject `v2/docs/spec-guidance-agent-core.md` as `SPEC_GUIDANCE` from the shared resolver.
- Guard-inversion checkpoint authoring is retired from plan prompts and default write-step rules.

## Primary implementation surface

- Plan draft and review-actuator prompt corpus (`prompts/plan/draft.md`, `prompts/plan/review-actuator.md`, and their shared assembly tests)

## Problem

- `prompts/plan/draft.md` Rules restate failing-test, agent-verifiable-AC, self-referential-deliverable, and product-vs-harness behavioral-AC guidance already injected via `SPEC_GUIDANCE`, worded differently from `v2/docs/spec-guidance-agent-core.md`.
- `prompts/plan/review-actuator.md` Rules restate the structural-vs-behavioral product-AC rewrite norm already covered by the injected agent core.
- Two divergent normative copies force agents to reconcile wording and require duplicate edits for every rule change.

## Behavior

- Plan-draft and review-actuator Rules sections keep only step mechanics: write boundaries, no commit/push, no tests, blocker contract, frontmatter preservation, subspec/index linkage, and verdict-application mechanics.
- Each authoring norm appears once in the assembled prompt, sourced from injected `SPEC_GUIDANCE`; removed prompt bullets do not survive in template bodies or appended step-rules sections.
- Where a removed prompt bullet and the agent-core copy disagreed in wording, the agent-core wording is authoritative and the delta is inventoried in the spec decision ledger.
- Plan-draft normalizer and validator behavior stay unchanged.

## Decisions

- Own authoring rules only in injected agent-core guidance; rules out retaining parallel normative copies in prompt Rules sections.
- Sequence after the agent-core injection split and guard-inversion retirement; rules out deduping into guidance files that were about to be split or deleting prose that checkpoint retirement already removed.
- Drop guard-inversion single-occurrence pins; rules out reintroducing retired checkpoint-authoring contract phrases solely to satisfy a stale seed bullet.
- Pin dedup with render tests that count contract phrases on the fully assembled plan-draft prompt (template plus injected `SPEC_GUIDANCE`); rules out body-only substring checks that miss duplicate injection zones.
- Preserve normalizer and validator behavior by citing existing plan workflow tests; rules out paraphrasing unchanged behavior in new AC prose.

## Acceptance criteria

- [ ] `shared/prompts/plan-draft.test.ts` asserts the fully assembled plan-draft prompt contains the failing-test contract phrase `fails against the pre-fix code and passes after the change` exactly once; it fails against the pre-fix duplicate Rules copy.
- [ ] The same test asserts `verifiable from the implement worktree without network or GitHub access` appears exactly once on the assembled plan-draft prompt; it fails against the pre-fix duplicate Rules copy.
- [ ] `shared/prompts/plan-draft.test.ts` `renders named pre-fix failing-test guidance without checkpoint authoring` stays green.
- [ ] Existing plan workflow tests covering plan-draft normalization and draft-contract validation stay green (behavior unchanged by the dedup).
- [ ] `bun run typecheck`, `bun run test:v1`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/prompts.md` — note that plan draft and review-actuator Rules carry step mechanics only, with authoring rules owned by injected `SPEC_GUIDANCE`.
