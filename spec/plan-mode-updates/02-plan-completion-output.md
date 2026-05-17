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
- Keep a short next-steps block with:
  - the draft PR link,
  - review/edit guidance,
  - the resume command for another self-review pass,
  - the implementation command to run after the spec PR is merged.
- Do not print either trailing success footer line, `plan: complete` or `plan mode: commits created and pushed to plan/<name>`, on successful initial plan completion.
- Apply the same cleanup to successful resume completion, including any equivalent footer lines after resume review commits.
- Preserve meaningful error, blocker, quota, and model-configuration output.
- Do not change PR state as part of this subspec unless the current implementation directly couples PR-ready behavior to the removed output. The required user-facing behavior is only the output cleanup; any internal PR-ready behavior must be documented accurately in subspec 04.
- The next-step paths must use the timestamped spec directory once subspec 00 is implemented.

## Tasks

- [ ] Update `src/commands/plan.ts` next-step rendering to remove the ready-for-review instruction and renumber the list.
- [ ] Remove redundant successful completion footer lines from initial plan runs.
- [ ] Remove equivalent redundant successful completion footer lines from resume runs.
- [ ] Update tests that snapshot or assert plan completion output.
- [ ] Add a regression test using output similar to the intent example, including assertions that the unwanted ready-flip instruction and footer lines are absent.

## Acceptance criteria

- [ ] Successful plan output does not instruct the user to mark the PR ready for review.
- [ ] Successful plan output does not include `plan: complete` or `plan mode: commits created and pushed to plan/<name>` as trailing footer lines.
- [ ] The output still includes the draft PR URL, review/edit guidance, resume command, and `jarvis run spec/.../index.md` implementation command.
- [ ] Blocker and error output remains unchanged except where it shares the same redundant success footer.
- [ ] `bun run typecheck` and `bun test` pass.

## Documentation updates

- Update docs in a later subspec in this spec tree so documented output and PR lifecycle match the new behavior.
