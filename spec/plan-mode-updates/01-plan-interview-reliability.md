# 01 - Plan Interview Reliability

## Problem

The interview phase is intended to clarify fuzzy intents before draft generation, but recent plan PRs show that it does not reliably improve the resulting spec. The examples in the intent indicate that interview output can be too mechanical or can ask low-value questions instead of gathering decisions that materially affect the spec.

## Decisions

- Treat this as an interview-quality fix, not a new product flow. Keep the existing number of turns, `question` tool shape, `intent.md` persistence contract, and blocker contract.
- Update `src/modes/plan/prompts/interview.md` so the agent first decides whether there are genuine unknowns that would change the spec. If not, it should end the interview and proceed to naming.
- Interview questions should be concrete product or implementation decisions. Avoid questions whose answer is already implied by the intent, the target repo conventions, or Jarvis spec guidance.
- The prompt should require a short rationale before asking, captured in the persisted interview turn, explaining why each question changes the downstream spec.
- Keep multiple-choice batching, but cap each turn to the smallest useful set of questions. A single high-value question is preferable to filling the batch.
- Add validation or tests around prompt behavior using fixture agents where practical. The implementation does not need to inspect semantic quality at runtime, but it should prevent regressions in the prompt contract.
- Naming remains required, but the name-only behavior should not force a fake interview question.

## Tasks

- [ ] Revise `src/modes/plan/prompts/interview.md` to emphasize decision-quality questions and early exit when no useful clarification is needed.
- [ ] Update the required persisted `## Interview turn N` format to include a concise "Why this matters" line per question.
- [ ] Adjust interview validation in `src/modes/plan/interview.ts` only if needed to support the updated persisted format.
- [ ] Add or update tests using stub agents for:
  - no useful questions, name only,
  - one useful clarifying question,
  - rejection of malformed persisted interview content if validation is tightened.

## Acceptance criteria

- [ ] Interview prompt tells agents to ask only questions that would materially change the draft spec.
- [ ] Interview prompt tells agents to skip questions and finish naming when the intent is already sufficient.
- [ ] Persisted interview turns record why each asked question matters.
- [ ] Existing `question` tool, turn budget, name proposal, and blocker behavior remain compatible.
- [ ] Tests cover the updated interview behavior or prompt contract.
- [ ] `bun run typecheck` and `bun test` pass.

## Documentation updates

- Update docs in a later subspec in this spec tree. This subspec may update prompt comments only where they are part of the runtime behavior.
