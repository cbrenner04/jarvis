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
  - the plan PR link,
  - review/edit guidance,
  - the resume command for another self-review pass,
  - the implementation command to run after the spec PR is merged.
- Do not print either trailing success footer line, `plan: complete` or `plan mode: commits created and pushed to plan/<name>`, on successful initial plan completion.
- Apply the same cleanup to successful resume completion, including any equivalent footer lines after resume review commits.
- Preserve meaningful error, blocker, quota, and model-configuration output.
- Do not change PR state as part of this subspec. If plan mode already marks successful plan PRs ready for review internally, keep that behavior unless a separate subspec explicitly changes it. This subspec removes the user-facing instruction, not the lifecycle behavior.
- Do not add a replacement success line for automatic PR-ready behavior. A warning is still acceptable if an existing best-effort ready transition fails.
- The next-step renderer should accept or derive the full spec index path instead of assuming `spec/<name>/index.md`, because subspec 00 introduces timestamped spec directory basenames.
- The next-step paths must use the timestamped spec directory once subspec 00 is implemented.

## Tasks

- [ ] Update `src/commands/plan.ts` next-step rendering to remove the ready-for-review instruction and renumber the list.
- [ ] Remove redundant successful completion footer lines from initial plan runs.
- [ ] Remove equivalent redundant successful completion footer lines from resume runs.
- [ ] Update next-step rendering to use the full spec path or timestamped spec directory basename rather than only the plan branch name.
- [ ] Update tests that snapshot or assert plan completion output.
- [ ] Add a regression test using output similar to the intent example, including assertions that the unwanted ready-flip instruction and footer lines are absent.

## Acceptance criteria

- [x] Successful plan output does not instruct the user to mark the PR ready for review.
- [x] Successful plan output does not include `plan: complete` or `plan mode: commits created and pushed to plan/<name>` as trailing footer lines.
- [x] The output still includes the PR URL, review/edit guidance, resume command, and `jarvis run spec/.../index.md` implementation command.
- [x] The resume and implementation commands use the timestamped spec path after subspec 00 is implemented.
- [x] Successful output does not add a new "PR marked ready" success line.
- [x] Blocker and error output remains unchanged except where it shares the same redundant success footer.
- [x] `bun run typecheck` and `bun test` pass.

## Documentation updates

- Update docs in a later subspec in this spec tree so documented output and PR lifecycle match the new behavior.
