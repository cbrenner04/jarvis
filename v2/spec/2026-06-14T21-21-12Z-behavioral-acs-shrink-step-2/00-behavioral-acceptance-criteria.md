# 00 - Behavioral acceptance criteria

## Problem

Plan-mode acceptance criteria that name files, modules, tables, or shapes mandate those structures at patch-run time — pass-through wrappers and parallel plumbing follow even when behavior is unchanged.

## Decisions

- Acceptance criteria state observable operator or runtime behavior, ruling out criteria that grade implementation structure ("lives in module X", "opens file Y per iteration").
- Structure may appear in criteria only when it is the contract (public API surface, wire format, on-disk artifact the operator must find), ruling out naming incidental layout choices.
- Behavioral-AC rule applies to target-repo product specs; harness subspecs may name hooks, telemetry fields, and internal symbols when structure is the contract, ruling out review over-correcting valid harness criteria.
- Document the rule in `v1/docs/spec-guidance.md` under subspecs/authoring, ruling out plan-prompt-only guidance with no durable operator doc.
- Layer the rule into `plan.prompt.draft` and live review surfaces (`plan.prompt.review.adversary`, `plan.prompt.review-actuator`), ruling out `prompts/plan/review.md` (registry fixture only).
- `plan.prompt.refine` unchanged unless measured escape rate warrants it; no speculative third prompt surface.

## Tasks

- [ ] Add a behavioral-AC section to `v1/docs/spec-guidance.md` with positive/negative examples (observable outcomes vs structural mandates) and the product-vs-harness distinction.
- [ ] Update `prompts/plan/draft.md` and live review surfaces (`plan.prompt.review.adversary`, `plan.prompt.review-actuator`) so generated/reviewed product subspecs use behavioral acceptance criteria.
- [ ] Bump prompt `revision` fields and registry expectations for touched plan prompt IDs (`plan.prompt.draft`, `plan.prompt.review.adversary`, `plan.prompt.review-actuator`).
- [ ] Add or extend prompt render/registry tests if the repo already asserts plan prompt content for similar rules.

## Acceptance criteria

- [ ] `v1/docs/spec-guidance.md` documents that acceptance criteria describe observable behavior and stay silent on schema, tables, files, and shapes unless structure is the contract; harness subspecs may name internal structure when it is the contract.
- [ ] `plan.prompt.draft` instructs behavioral acceptance criteria for product specs with at least one observable-outcome example and one structural anti-example.
- [ ] `plan.prompt.review.adversary` and `plan.prompt.review-actuator` instruct reviewers to rewrite structural product acceptance criteria into behavioral ones.
- [ ] Prompt registry load and render tests pass for touched plan prompt IDs.

## Documentation updates

- [ ] `v1/docs/spec-guidance.md` — behavioral-AC rule (primary deliverable).
- [ ] `v2/docs/v1-behaviors.md` — plan-mode spec authoring expects behavioral acceptance criteria.
