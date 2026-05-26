# 01 - Harden plan prompts against self-referential specs

## Decisions

- Add one anti-meta rule across inline draft, draft, and refine prompts.
- Define the rule in terms of verifiable target state outside the active spec tree.
- Treat self-referential acceptance criteria as invalid even when they avoid the literal phrase "the spec".
- Require acceptance criteria to verify code, tests, docs, operator behavior, or generated evidence outside the active spec directory.
- Keep the first hardening at the prompt contract layer only.
- Deferred to first consumer: whether anti-meta enforcement also needs validator code — pin when a caller needs it.
- Update prompt snapshots/tests in the same change because prompt text is exercised.
- Record the operator-visible plan-mode behavior change in durable docs in the same change.

## Constraints

- Update `prompts/plan/inline-draft.md`, `prompts/plan/draft.md`, and `prompts/plan/refine.md` together.
- Keep this subspec to prompt contract and its tests/docs.
- Do not reopen the meta-index framing here; that source fix belongs to `00`.
- Do not invent broader prompt precision beyond the anti-meta rule.

## Task checklist

- Add matching anti-meta guidance to the inline-draft, refine, and draft prompt templates.
- Update the prompt tests and snapshots that exercise those templates.
- Align the durable docs.

## Acceptance criteria

- [ ] `prompts/plan/inline-draft.md`, `prompts/plan/draft.md`, and `prompts/plan/refine.md` all instruct the planner to avoid self-referential spec deliverables and to ground acceptance criteria in target state outside the active spec tree.
- [ ] The rule text is strong enough that criteria grading only prose inside the active spec directory are out of bounds even when phrased without the words "the spec".
- [ ] `v1/test/modes/plan/prompts.test.ts` and any checked-in prompt snapshots/fixtures covering these templates are updated to assert the new anti-meta contract.
- [ ] `v1/docs/spec-guidance.md` and `v2/docs/v1-behaviors.md` record the new anti-self-reference rule.

## Documentation updates

- Update `v1/docs/spec-guidance.md`.
- Update `v2/docs/v1-behaviors.md`.
