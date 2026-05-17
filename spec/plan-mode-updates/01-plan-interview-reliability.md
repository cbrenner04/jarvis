# 01 - Plan Interview Reliability

## Problem

The interview phase is intended to clarify fuzzy intents before draft generation, but recent plan PRs show that it does not reliably improve the resulting spec. The examples in the intent indicate that interview output can be too mechanical, can ask low-value questions, and can spend turns collecting preferences that do not change the eventual subspecs.

## Decisions

- Treat this as an interview-quality fix, not a new product flow. Keep the existing number of turns, `question` tool shape, `intent.md` persistence contract, and blocker contract.
- Update `src/modes/plan/prompts/interview.md` so the agent first decides whether there are genuine unknowns that would change the spec's scope, sequencing, acceptance criteria, or documentation requirements. If not, it should end the interview and proceed to naming.
- Interview questions should be concrete product or implementation decisions. Avoid questions whose answer is already implied by the intent, the target repo conventions, or Jarvis spec guidance.
- The prompt should require the agent to identify the downstream spec detail controlled by each question before it asks. That rationale must be captured in the persisted interview turn so review can distinguish useful clarification from preference collection.
- The persisted rationale should use a stable, easy-to-validate text shape, for example `Why this matters: <one sentence>`, immediately before the matching question.
- The updated persisted format should be explicit enough for tests to assert. A question entry should include the question header, a `Why this matters:` line, the exact question text, and the selected or typed answer.
- If a turn asks no questions because the intent is already sufficient, the agent should either make a frontmatter-only naming update or append a short no-question `## Interview turn N` section using a stable sentence such as `No material clarification was needed before drafting.` The implementation should choose one contract and document it in the prompt and tests.
- Keep multiple-choice batching, but cap each turn to the smallest useful set of questions. A single high-value question is preferable to filling the batch.
- Do not attempt to enforce semantic quality at runtime. Runtime validation may enforce only structural safety, such as append-only edits and the presence of required `Why this matters:` lines when a turn section records questions. Use prompt text and fixture-agent tests to prevent regressions in question quality.
- Naming remains required, but the name-only behavior should not force a fake interview question.
- When the intent is sufficient, the persisted interview output should make that decision visible without inventing a question, for example by recording that no material clarification was needed before the proposed name.
- Keep the current behavior that no disk change during an interview turn means the interview is done only if the implementation intentionally retains that contract; otherwise update the validation and tests so a skipped-question turn has one clear observable shape.

## Tasks

- [ ] Revise `src/modes/plan/prompts/interview.md` to emphasize decision-quality questions and early exit when no useful clarification is needed.
- [ ] Update the required persisted `## Interview turn N` format to include a concise `Why this matters:` line per asked question.
- [ ] Define and document the no-question persisted format, or explicitly preserve frontmatter-only naming as the no-question completion signal.
- [ ] Adjust interview validation in `src/modes/plan/interview.ts` only where needed to support the chosen persisted format and reject structurally malformed interview-turn additions.
- [ ] Add or update tests using stub agents for:
  - no useful questions, name only,
  - one useful clarifying question,
  - multiple-choice batching without padding,
  - preservation of seeded intent body content and leading frontmatter,
  - rejection of malformed persisted interview content if validation is tightened.

## Acceptance criteria

- [ ] Interview prompt tells agents to ask only questions that would materially change the draft spec.
- [ ] Interview prompt tells agents to skip questions and finish naming when the intent is already sufficient.
- [ ] Persisted interview turns record why each asked question matters.
- [ ] A no-question interview can complete without requiring a fake question.
- [ ] If no-question completion is persisted as an interview turn, it can be resumed safely; if it completes through a frontmatter-only naming update, tests make that behavior explicit instead.
- [ ] Validation continues to reject edits to existing non-frontmatter intent content.
- [ ] Existing `question` tool, turn budget, name proposal, and blocker behavior remain compatible.
- [ ] Tests cover the updated interview behavior or prompt contract.
- [ ] `bun run typecheck` and `bun test` pass.

## Documentation updates

- Update docs in a later subspec in this spec tree. This subspec may update prompt comments only where they are part of the runtime behavior.
