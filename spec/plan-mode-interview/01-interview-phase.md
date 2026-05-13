# 01 — Interview phase with persistent `intent.md` updates

## Problem

Add an interview phase between (worktree creation + intent seeding)
and the draft phase. The agent runs up to `--interview-turns N`
question-asking turns, persisting answers to `intent.md` between
turns. The phase replaces the previous "single `plan: interview`
commit with only seed content" with a richer interview-driven
artifact.

This subspec wires up the question loop, persistence, validation, and
budget enforcement. Interactive-mode invocation and agent-proposed
naming are handled by subspecs 02 and 03 of this spec; this subspec
keeps the deterministic naming from
`spec/plan-mode-worktree-and-commits/02` and the existing input
modes.

## Decisions

- **Insertion point.** After `seedIntentFile` writes the initial
  `intent.md`, run the interview loop. The `plan: interview` commit
  is delayed until the loop completes (or stops early); previously it
  was made immediately after seeding.
- **Per-turn agent invocation.** Same agent-spawn helper as draft and
  review. Prompt template: `src/modes/plan/prompts/interview.md`. The
  prompt:
  - Inlines the current `intent.md`.
  - Inlines `docs/spec-guidance.md`.
  - States the remaining turn budget (`Turns remaining: <N>`).
  - Tells the agent it may use the `question` tool to ask a batched
    set of multiple-choice questions, then **must** append a `##
    Interview turn <N>` section to `intent.md` capturing the
    questions and answers.
  - Tells the agent to skip asking (and skip writing) if it has
    enough information; doing so signals "interview complete" to
    plan mode.
  - Tells the agent it may append `## Blocker` to `intent.md` instead
    of asking, if it cannot proceed without human input it cannot
    extract via questions.
  - Tells the agent: do not modify any pre-existing content in
    `intent.md`; do not write any other files.
- **Budget.** Loop runs at most `--interview-turns` iterations
  (default 3 from skeleton parser). Each iteration is one agent
  invocation.
- **Per-turn validation.** After each agent invocation:
  - If `intent.md` is unchanged and no `question` tool call was
    issued during the turn, treat as "agent done" — break the loop.
  - If `intent.md` is unchanged but a `question` tool call was
    issued (the agent asked but did not write the answers), exit `1`
    with a violation message — this would create silent data loss.
  - If `intent.md` gained exactly one new `## Interview turn <N>`
    section at the end (where N matches the expected next turn
    number) and nothing else changed, accept the turn.
  - If `intent.md` was modified in any other way (existing content
    changed, multiple sections added, sections out of order), exit
    `1` with a violation message.
  - Blocker exception: a `## Blocker` section appended to `intent.md`
    is accepted as an interview-stop signal and triggers the
    blocker handling from
    `spec/plan-mode-draft-and-review/03-stop-conditions-and-blockers.md`.
- **Empty turn after seed.** If the budget is N but the agent says
  "done" on turn 1, the loop exits cleanly and the interview commit
  reflects only the seed text.
- **`plan: interview` commit shape (updated):**
  - Subject: unchanged (`plan: interview`).
  - Body:

    ```text
    Seeded from <file|inline|interactive>.
    Turns: <completed-turn-count>
    ```

    Where `<interactive>` is the new label for interactive mode
    (subspec 02 will start producing it).
- **Push.** Same as before: push after the commit, first push uses
  `-u`.
- **Quota fallback applies per turn.** Same pattern as draft/review.
  If all agents are exhausted mid-interview, exit with the
  quota-exhausted code; the worktree contains whatever turns
  completed (uncommitted). The user can re-run later (resume in a
  later spec) to pick up.
- **No interview if budget is 0.** When `--interview-turns 0`, skip
  the loop entirely. File/inline modes proceed straight to draft
  with the seeded `intent.md`. (Interactive mode handling for `0`
  is deferred to subspec 02.)
- **No `question`-tool harness change.** The existing `question`
  tool already routes from agent → harness → user. Plan mode adds a
  per-invocation observation: did this invocation use the tool?
  Detection mechanism is the same one harness uses today to surface
  `question` interactions.

## Implementation hints

- Snapshot `intent.md` before each agent invocation; diff against the
  post-invocation state to drive validation.
- "Did the agent invoke the `question` tool" is observable from the
  log-server transcript or from the agent harness's own
  bookkeeping; pick whichever is least invasive.

## Tasks

- [ ] Add `src/modes/plan/prompts/interview.md`.
- [ ] Add `buildInterviewPrompt` helper.
- [ ] Implement the interview loop in `planCommand`, between
  `seedIntentFile` and the `plan: interview` commit.
- [ ] Move the `plan: interview` commit to after the loop.
- [ ] Update commit body shape to include `Turns: <N>`.
- [ ] Implement per-turn validation (including the question-asked-
  but-not-written failure case).
- [ ] Wire blocker detection into the interview loop.
- [ ] Quota fallback per turn.
- [ ] Tests:
  - Stub agent that asks 2 turns then declines on turn 3 → `intent.md`
    has 2 `## Interview turn N` sections; commit body says `Turns: 2`.
  - Stub agent that declines on turn 1 → no interview sections;
    commit body says `Turns: 0`.
  - `--interview-turns 0` → loop is not entered; commit body says
    `Turns: 0`.
  - Stub agent that asks but does not write → exit `1`,
    interview-validation message identifies the failure.
  - Stub agent that modifies existing `intent.md` content → exit `1`.
  - Stub agent that appends `## Blocker` to `intent.md` → blocker
    flow from existing spec triggers; `plan: blocker` commit lands.
  - Quota exhaustion mid-interview → exit with existing
    quota-exhausted code; uncommitted turns remain in worktree.

## Acceptance criteria

- [ ] Interview loop runs up to `--interview-turns` iterations,
  appending `## Interview turn N` sections to `intent.md` per turn.
- [ ] `plan: interview` commit body includes the completed turn
  count.
- [ ] Per-turn validation rejects malformed agent output.
- [ ] Blocker convention handled during interview.
- [ ] Quota fallback per turn.
- [ ] `bun run typecheck`, `bun test`, `bun run check` all pass.

## Documentation updates

- None. Subspec 04 covers docs.
