# 02 - Plan Completion Output

## Problem

The final output after a successful plan run contains two pieces of friction:

- The "Next steps" list tells the user to mark the PR ready for review, but the desired flow is to review and merge the draft spec PR without this explicit ready-flip instruction.
- The final lines
  `plan: complete`
  and
  `plan mode: commits created and pushed to plan/<name>`
  are redundant after the PR URL, review-pass messages, and next-step commands.

## Decisions

- Remove the "Mark the PR ready for review" next-step instruction from successful plan output.
- Keep the draft PR link and the implementation command in the next steps.
- Do not print the trailing `plan: complete` and `plan mode: commits created and pushed to plan/<name>` lines on successful initial plan completion.
- Apply the same cleanup to successful resume completion where equivalent redundant lines are printed.
- Preserve meaningful error, blocker, quota, and model-configuration output.
- Decide whether plan mode should still mark the PR ready internally by reading the current implementation and docs. The user-facing requirement is to remove the instruction; if automatic ready marking is retained or removed, tests and docs must make the behavior explicit.

## Tasks

- [ ] Update `src/commands/plan.ts` next-step rendering to remove the ready-for-review instruction and renumber the list.
- [ ] Remove redundant successful completion footer lines from initial plan runs.
- [ ] Remove equivalent redundant successful completion footer lines from resume runs.
- [ ] Update tests that snapshot or assert plan completion output.
- [ ] Add a regression test using output similar to the intent example.

## Acceptance criteria

- [ ] Successful plan output does not instruct the user to mark the PR ready for review.
- [ ] Successful plan output does not end with both `plan: complete` and `plan mode: commits created and pushed to plan/<name>`.
- [ ] The output still includes the draft PR URL, review/edit guidance, resume command, and `jarvis run spec/.../index.md` implementation command.
- [ ] Blocker and error output remains unchanged except where it shares the same redundant success footer.
- [ ] `bun run typecheck` and `bun test` pass.

## Documentation updates

- Update docs in a later subspec in this spec tree so documented output and PR lifecycle match the new behavior.
