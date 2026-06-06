# Move patch review onto shared flow

Route patch review through the shared review runner while preserving patch-specific baseline/final gates, prompt inputs, spec-tree protection, blocker comments, commit subjects, PR refresh, and readiness transition.

## Decisions

- Patch review keeps `prompts/patch/review.md` and branch-diff/spec-tree prompt inputs.
- Patch review keeps baseline `bun run ready` before passes and final `bun run ready` plus `gh pr ready` after passes.
- Patch review keeps read-only spec behavior: revert spec-tree edits, including untracked additions.
- Patch review keeps `.jarvis-review-blocker` as the blocker source and posts blocker content as a PR comment.
- Patch review keeps `review: pass N` commit subjects and PR footer refresh.
- Patch review uses the same shared runner pass loop as plan review.

## Task checklist

- Replace `runReviewPhase`'s local review pass loop with the shared runner and a patch adapter.
- Keep baseline and final ready gates outside the runner unless the adapter hooks make them clearer.
- Preserve patch review telemetry rows with `patch_phase: "review"` and configured review model metadata.
- Preserve review timeout behavior.
- Update patch review tests to assert shared-runner behavior through user-visible outcomes.

## Acceptance criteria

- [ ] Patch review calls the shared review runner for its N review passes.
- [ ] Baseline `bun run ready` still runs before the first review pass and failure stops review before any agent pass.
- [ ] Final `bun run ready` and `gh pr ready` still run only after all review passes complete.
- [ ] Spec-tree edits during patch review are still reverted, including untracked additions, before commit.
- [ ] `.jarvis-review-blocker` still stops review with exit 7, is consumed, and posts a PR comment when possible.
- [ ] Non-empty patch review edits still commit as `review: pass N`; empty passes do not create commits.
- [ ] Quota fallback, all-agent quota exit 2, model-config exit 3, and hard-error handling match the shared runner tests.
- [ ] Patch review telemetry still records review attempts separately from implementation attempts.
- [ ] `bun run typecheck` and `bun test` pass.

## Documentation updates

- `v1/docs/run-loop.md`: describe patch review as using the shared review flow with patch-specific gates and write policy.
- `v1/docs/workflows.md`: update the patch review diagram only if control-flow labels changed.
- `v2/docs/v1-behaviors.md`: record that plan and patch review use one v1 review runner with mode-specific adapters.
