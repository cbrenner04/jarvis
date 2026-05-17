# 01 - Plan Interview Reliability

## Problem

Plan mode has an "interview" phase, but with the current spawn-agent architecture it is not interactive. Jarvis runs an underlying agent CLI for the phase, waits for it to exit, then validates disk changes. There is no supported channel where that agent can pause, ask Jarvis structured questions, have Jarvis ask the terminal user, and resume the same agent turn with the answers.

The current prompt still describes the phase as if questions are asked and answers are collected. In the example PRs linked from the intent, the interview commit does not contain questions, answers, assumptions, analysis, or blockers. It just commits the seed `intent.md` verbatim. That means the interview phase is currently producing no reviewable value before drafting.

## Decisions

- Define interview mode as non-interactive, period.
- Remove prompt language that tells agents to ask the user questions, use a question tool, or record user answers.
- Interview mode should be an intent-refinement pass. The agent may inspect the target repo and append useful planning context to `intent.md`, such as inferred constraints, assumptions, scope boundaries, risks, or draft-shaping notes.
- If the intent is already sufficient and no useful refinement exists, interview mode must represent that honestly. It may append a stable skip/no-op note or skip creating an interview-content commit, but it must not commit the seed intent verbatim as if interview work happened.
- If the agent needs human input before a useful spec can be drafted, it must append a `## Blocker` section to `intent.md` and stop. It must not invent answers or fake a Q&A transcript.
- Preserve the existing `--interview-turns` option, turn budget, name proposal requirement, blocker contract, resume behavior, and append-only protection unless a change is directly required by this non-interactive contract.
- Default CLI output should make the non-interactive interview phase observable with concise start and terminal outcome lines: refined, skipped/no-op, blocker, or failed.
- Interview progress output must not print the full intent, prompt, worktree path, or setup diagnostics that the CLI-verbosity subspec is meant to quiet.
- Runtime validation should remain structural. It should protect existing non-frontmatter intent content and validate the chosen appended interview/blocker/skip shape, but it should not try to judge the quality of the agent's reasoning.

## Tasks

- [ ] Audit the example PR interview commits from the intent and the current `src/modes/plan/interview.ts` flow to confirm why `intent.md` is committed verbatim.
- [ ] Rewrite `src/modes/plan/prompts/interview.md` around non-interactive intent refinement. Remove references to asking questions, batching questions, the `question` tool, and recording user answers.
- [ ] Define the allowed persisted interview outcomes:
  - appended refinement notes,
  - appended `## Blocker`,
  - explicit skip/no-op when no useful refinement is needed.
- [ ] Stop representing a verbatim seed-intent commit as interview output. Either skip the interview commit when nothing changed, or commit an explicit skip/no-op marker so the result is reviewable.
- [ ] Add concise default CLI progress around the interview phase, including start and terminal outcome messages.
- [ ] Preserve quiet output goals from the CLI-verbosity subspec; do not reintroduce setup diagnostics as interview progress.
- [ ] Update interview validation only where needed to support the chosen persisted shapes while preserving append-only protection for existing intent body content.
- [ ] Add or update tests for:
  - prompt text does not describe interactive questions or user answers,
  - verbatim seed-intent output is not treated as successful interview work,
  - successful non-interactive refinement appends reviewable content,
  - explicit skip/no-op behavior when no refinement is needed,
  - blocker behavior when human clarification is required,
  - preservation of seeded intent body content and leading frontmatter.

## Acceptance criteria

- [ ] Interview mode is documented and implemented as non-interactive.
- [ ] The interview prompt no longer tells agents to ask the user questions, use a question tool, or record user answers.
- [ ] Interview mode no longer commits the original seed intent verbatim as if useful interview work happened.
- [ ] A successful interview produces reviewable refinement content or an explicit skip/no-op result.
- [ ] Missing human clarification is represented as a visible `## Blocker`, not invented answers.
- [ ] Users see concise interview progress and a clear terminal interview outcome.
- [ ] Existing `--interview-turns`, turn budget, name proposal, blocker, commit, and resume behavior remain compatible except where the no-op fix explicitly changes commit behavior.
- [ ] Validation continues to reject edits to existing non-frontmatter intent content.
- [ ] Tests cover the corrected non-interactive interview contract.
- [ ] `bun run typecheck` and `bun test` pass.

## Documentation updates

- Update docs in a later subspec in this spec tree so plan-mode documentation describes interview as non-interactive intent refinement and explains the possible outcomes: refinement, skip/no-op, blocker, or failure.
