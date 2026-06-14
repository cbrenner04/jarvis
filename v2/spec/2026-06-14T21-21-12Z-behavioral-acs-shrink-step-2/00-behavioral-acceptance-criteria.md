# 00 - Behavioral acceptance criteria

## Problem

Plan-mode acceptance criteria that name files, modules, tables, or shapes mandate those structures at patch-run time — pass-through wrappers and parallel plumbing follow even when behavior is unchanged.

## Decisions

- Acceptance criteria state observable operator or runtime behavior, ruling out criteria that grade implementation structure ("lives in module X", "opens file Y per iteration").
- Structure may appear in criteria only when it is the contract (public API surface, wire format, on-disk artifact the operator must find), ruling out naming incidental layout choices.
- Document the rule in `v1/docs/spec-guidance.md` under subspecs/authoring, ruling out plan-prompt-only guidance with no durable operator doc.
- Layer the rule into plan draft and review prompts (fragment or inline), ruling out draft-only guidance that review never enforces.
- Refine prompt unchanged unless a draft/review pass shows structural ACs escaping refine; no speculative third prompt surface.

## Tasks

- [ ] Add a behavioral-AC section to `v1/docs/spec-guidance.md` with positive/negative examples (observable outcomes vs structural mandates).
- [ ] Update `prompts/plan/draft.md` (and `prompts/plan/review.md` if needed) so generated/reviewed subspecs use behavioral acceptance criteria.
- [ ] Bump prompt `revision` fields and registry expectations for touched plan prompts.
- [ ] Add or extend prompt render/registry tests if the repo already asserts plan prompt content for similar rules.

## Acceptance criteria

- [ ] `v1/docs/spec-guidance.md` documents that acceptance criteria describe observable behavior and stay silent on schema, tables, files, and shapes unless structure is the contract.
- [ ] `prompts/plan/draft.md` instructs behavioral acceptance criteria with at least one observable-outcome example and one structural anti-example.
- [ ] `prompts/plan/review.md` instructs reviewers to rewrite structural acceptance criteria into behavioral ones.
- [ ] Prompt registry load and render tests pass for touched plan prompt IDs.

## Documentation updates

- [ ] `v1/docs/spec-guidance.md` — behavioral-AC rule (primary deliverable).
- [ ] `v2/docs/v1-behaviors.md` — plan-mode spec authoring expects behavioral acceptance criteria.
