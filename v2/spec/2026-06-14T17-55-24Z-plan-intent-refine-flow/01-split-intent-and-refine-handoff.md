# Split intent and refine handoff

Committed fresh plans produce two history steps: `plan: intent` for intent creation and `plan: refine` for refinement. After refine, Jarvis opens/updates the draft PR and exits `0` with next steps; it does not manufacture a review-gate `## Blocker`.

## Decisions

- Commit intent creation as `plan: intent`, ruling out continuing to overload `plan: refine` as the seed commit.
- Change default `--refine-turns` from `3` to `1`, ruling out multi-turn default refinement.
- Stop after committed fresh-run refine with exit `0`, ruling out the synthetic Phase-0 blocker exit `1`.
- Open the draft PR after `plan: refine` when `commit: true`, ruling out waiting for `plan: draft`.
- Open or refresh only the current branch's open draft PR, ruling out broad rerun/idempotency behavior across closed or unrelated PRs.
- Preserve genuine `## Blocker` handling during refine, ruling out treating all refine stops as clean handoffs.
- Keep `--resume-draft <intent>` as the operator continuation command, ruling out immediate draft/review after committed fresh refine.
- Validate `--resume-draft` against genuine blocker presence only, ruling out the deleted synthetic-blocker clearance check.
- Treat only the historical generated gate-blocker marker/text as synthetic on `--resume-draft`, ruling out ignoring genuine existing blockers.
- Committed `--refine-turns 0` still commits `plan: intent`, opens or refreshes the draft PR, exits `0`, and prints the same review-then-`--resume-draft` handoff, ruling out silently continuing to draft.

## Tasks

- Add `plan: intent` commit creation, push, PR attribution support, and PR body coverage for intent-only branches.
- Adjust refine commit creation so it records only refine results and uses the new default turn count.
- Remove `shouldStopAfterPhase0Refine`, `appendPhase0ReviewGateBlocker`, and synthetic blocker call sites.
- Open/update the draft PR after committed refine succeeds, before exiting the fresh invocation.
- Change next-steps output after refine to review the PR then run `jarvis1 plan --resume-draft <intent>`.
- Update `--resume-draft` validation to reject only genuine `## Blocker` sections.
- Recognize and ignore only legacy generated gate blockers on `--resume-draft`.
- Apply the same PR open/update and next-steps behavior after committed
  `--refine-turns 0`.
- Preserve existing draft/review phase behavior after `--resume-draft`.
- Update plan command, PR, commit, and end-to-end tests for the two-commit handoff.

## Acceptance criteria

- [x] A successful committed fresh run creates `plan: intent` followed by `plan: refine`.
- [x] Successful committed fresh refine opens or updates a draft PR, prints `--resume-draft <intent>` next steps, and exits `0`.
- [x] Committed `--refine-turns 0` creates `plan: intent`, opens or updates the draft PR, prints the same `--resume-draft <intent>` next steps, and exits `0`.
- [x] No synthetic `## Blocker` is appended to `intent.md` after successful refine.
- [x] A genuine agent-authored `## Blocker` during refine commits `plan: blocker` and exits `1`.
- [x] `jarvis1 plan --resume-draft <intent>` proceeds when no genuine blocker exists, ignores only historical generated gate blockers, and still refuses when a genuine `## Blocker` exists.
- [x] PR open/update is scoped to the current branch's open draft PR; closed or unrelated PRs are not reused.
- [x] Default refine budget is one turn unless `--refine-turns` overrides it.
- [x] Tests cover commit ordering, PR creation after refine, no synthetic blocker, genuine blocker preservation, resume-draft validation, and default refine-turn count.

## Documentation updates

- Rewrite `v1/docs/plan-mode.md` phases, commit shapes, stop conditions, PR lifecycle, next steps, `--resume-draft`, and `--refine-turns`.
- Update `v2/docs/v1-behaviors.md` plan-mode bullets and flow matrix for the new committed fresh-run handoff.
- Update `v1/docs/config.md` wherever the plan refine-turn default is described.
- Cross-link durable workflow/design decisions from the relevant `v2/docs/`
  homes per `v2/docs/documentation-standard.md`; do not duplicate behavior only
  in subspec prose.
