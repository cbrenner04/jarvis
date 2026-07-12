# v2 plan prompt lacks the write-loop done-token contract

With the spawn stall fixed, `jarvis run workflow plan-reviewed-light` now invokes
its agent — and immediately fails `invalid_token`, discarding completed work.

## Problem

Observed 2026-07-12, run `afb76a23`:

- The plan agent **did the work**. Its output begins: `Spec tree written under
  v2/spec/<slug>/` followed by a table of the files it authored.
- It ended with prose, not the write loop's terminal token, so the boundary
  committed `outcomeKind: invalid_token` and the run finished
  `invocation_failure`, non-resumable. The drafted spec is thrown away.

This is the **same defect already fixed for the intent workflow** in `b1c42ce3`
("wire v2 intent split prompt for staging files and done token"), whose message
reads: *"v2 rendered `intent.prompt.split` without v1 file-output suffix or
write-loop step rules, so agents dumped markdown to stdout and failed
`invalid_token` with no worktree changes."*

The plan prompts (`plan.prompt.*`) never received that treatment. v1's plan mode
does not have the bug — only v2's rendering of the prompt does.

## Scope

- Render the v2 plan prompts with the same file-output suffix and write-loop step
  rules the intent split prompt now gets, so the agent knows to write files and
  terminate with the expected token.
- Share the prompt builder across v1/v2 rather than forking, mirroring
  `shared/prompts/intent-split.ts`.
- **Audit every other v2 prompt for the same gap** — this is the second instance
  of one bug. `intent.prompt.review`, `plan.prompt.review.*`, and any implement
  prompts should be checked, not just plan draft.

## Decisions

- Fix the prompt contract, not the token parser. A strict terminal token is the
  right contract; the prompt failing to state it is the defect.
- The spec tree the agent wrote in the failing run used a non-conventional
  timestamp (`20260712T160159Z-...`, no separators) versus the repo's
  `2026-07-12T16-01-59Z-` convention. Whatever prompt text pins the naming
  convention is evidently not reaching the plan agent either — same root cause,
  worth confirming in the same change.

## Out of scope

- The spawn stall (fixed: `plan-workflow-write-step-invokes-agent`).
- Making `invalid_token` resumable.

## Documentation updates

- `v2/docs/prompts.md` — which prompts carry the write-loop contract, and the
  rule that every write-behavior prompt must.
