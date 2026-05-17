# 01 - Plan Interview Reliability

## Problem

Plan mode's "interview" phase is presented like it clarifies the user's intent, but current Jarvis behavior does not appear to add any information before drafting. In the example PRs linked from the intent, the interview commit contains `intent.md` verbatim from the seed intent, with no appended analysis, questions, answers, assumptions, or blocker.

The failure is therefore more basic than low-quality questions or missing terminal feedback: the phase effectively does nothing useful today. The user cannot review interview output because there is no interview output beyond the original intent.

## Decisions

- Treat this as a no-op interview fix for the existing plan flow, not as a prompt-only "better questions" fix.
- The implementation must first make the interview phase produce a meaningful, reviewable result or explicitly remove/disable the phase. Do not keep committing a verbatim copy of the seed intent as if an interview happened.
- Do not rely on an agent-side `question` tool unless Jarvis actually wires a supported user-interaction channel through the agent invocation. If that bridge is not implemented in this subspec, remove or rewrite prompt text that tells agents to ask the user questions.
- Preserve the existing `--interview-turns` option, turn budget, `intent.md` persistence contract, name proposal requirement, blocker contract, commits, and resume behavior unless a change is directly required to make interview behavior honest.
- During each interview turn, default CLI output should show concise progress so the user can tell that interview mode is running. It should include at least a start line before the first agent invocation and a completion, no-op/skip, blocker, or failure line when the phase ends.
- Progress output must not dump the full intent, prompt, worktree path, or other setup diagnostics that the CLI-verbosity subspec is meant to quiet.
- If Jarvis keeps interview mode non-interactive, the interview prompt should frame the phase as intent analysis/refinement: the agent may append useful assumptions, discovered gaps, or a blocker to `intent.md`, but it must not pretend it received answers from the user.
- If the agent cannot draft a useful spec without human clarification, it should append a `## Blocker` section explaining the missing decision instead of inventing answers or writing fake Q&A.
- If a real user-question bridge is implemented instead, the prompt, runtime behavior, and tests must cover the actual CLI/user interaction path end to end. The user must visibly receive the questions and Jarvis must persist the user's actual answers.
- A no-change interview result must not be treated as successful interview work. It may be allowed only as an explicit skip/no-op path that is visible in CLI output and represented accurately in commits/PR body text.
- Runtime validation should remain structural: it should protect existing non-frontmatter intent content and reject malformed writes where needed. Do not try to enforce semantic interview quality at runtime.

## Tasks

- [ ] Audit the example PR interview commits from the intent and the current `src/modes/plan/interview.ts` flow to confirm why `intent.md` is committed verbatim.
- [ ] Update `src/modes/plan/prompts/interview.md` so it no longer promises invisible user questions. Either define the phase as non-interactive intent analysis or describe the real user-question bridge implemented by this subspec.
- [ ] Add concise default CLI progress around the interview phase, including start and terminal outcome messages.
- [ ] Stop representing a verbatim seed-intent commit as meaningful interview output. Either append meaningful interview analysis/blocker content, skip the interview commit when nothing changed, or label the result clearly as skipped/no-op.
- [ ] Preserve quiet output goals from the CLI-verbosity subspec: do not reintroduce setup diagnostics as interview progress.
- [ ] Ensure blocker handling remains visible when interview mode determines that human clarification is required.
- [ ] Update interview validation only where needed to support the chosen persisted format while preserving append-only protection for existing intent body content.
- [ ] Add or update tests for:
  - current-regression coverage showing that verbatim seed-intent interview output is not treated as successful interview work,
  - successful non-interactive interview completion that appends meaningful analysis or explicitly records a skip/no-op,
  - name-only completion without pretending interview content was produced,
  - blocker output when clarification is required,
  - prompt text that does not claim user questions are asked unless a real interaction bridge exists,
  - preservation of seeded intent body content and leading frontmatter.

## Acceptance criteria

- [ ] Interview mode no longer commits the original seed intent verbatim as if useful interview work happened.
- [ ] Interview mode no longer claims or implies that user questions are asked unless Jarvis actually shows those questions to the user and persists the answers.
- [ ] Users see concise progress while the interview phase is running and a clear terminal interview outcome.
- [ ] A non-interactive interview can complete with meaningful appended analysis, an explicit skip/no-op result, or a blocker, without fake questions or fake answers.
- [ ] Missing human clarification is represented as a visible blocker, not invented interview output.
- [ ] Existing `--interview-turns`, turn budget, name proposal, blocker, commit, and resume behavior remain compatible.
- [ ] Validation continues to reject edits to existing non-frontmatter intent content.
- [ ] Tests cover the corrected interview behavior and prompt contract.
- [ ] `bun run typecheck` and `bun test` pass.

## Documentation updates

- Update docs in a later subspec in this spec tree so plan-mode documentation describes what the interview phase actually does and what the user should expect to see in the terminal.
