# 00 - Partition review-phase and resume-review tests

## Problem

`v1/test/run.test.ts` still holds the completion-review coverage
(`describe("review phase")`) and the `--resume-review` coverage
(`describe("--resume-review: review resume on completed specs")`). Relocate both
into one dedicated review test file.

## Decisions

- Group completion-review and `--resume-review` coverage in one new file
  `v1/test/run-command-review.test.ts`; rules out two separate review files that
  would each re-duplicate the same review fixtures.
- Behavior-preserving move: relocate the assertions unchanged; rules out
  editing review semantics while moving.
- Move only the `review phase` and `--resume-review` describe blocks; leave the
  `agent stream handling` regression block in `v1/test/run.test.ts`; rules out
  sweeping adjacent non-review coverage.
- Copy the review fixtures the moved blocks need (`setupReviewEnv`,
  `reviewFakeAgent`, `isPatchReviewPrompt`, `isPatchReviewActuatorPrompt`, and
  the shared io/idle/agent-entry helpers) into the new file per the existing
  per-file duplication convention in `run-command-routing.test.ts`; rules out a
  shared-helper-module extraction. The originals stay in `run.test.ts` because
  the post-completion gate and `--agent` override blocks that remain there still
  use them.

## Task checklist

- Create `v1/test/run-command-review.test.ts` with the moved `review phase` and
  `--resume-review` describe blocks plus the helpers/imports they need.
- Delete both describe blocks from `v1/test/run.test.ts`; keep the shared
  helpers there (still used by remaining blocks).
- Verify both files independently and through `bun run test:v1`.

## Acceptance criteria

- [ ] The 13 `review phase` tests and 11 `--resume-review` tests relocate to
  `v1/test/run-command-review.test.ts` and stay green there (behavior unchanged
  by the move).
- [ ] `v1/test/run.test.ts` no longer contains the `describe("review phase")` or
  `describe("--resume-review: review resume on completed specs")` blocks and
  stays green after the extraction.
- [ ] Total run-command test count is preserved: the 24 relocated tests are
  removed from `v1/test/run.test.ts` and present in
  `v1/test/run-command-review.test.ts`, with no test dropped.
- [ ] `bun run test:v1` and `bun run typecheck` pass.

## Documentation updates

None — test-only behavior-preserving partition. No v1 runtime behavior changes,
so `v2/docs/v1-behaviors.md` needs no update.
