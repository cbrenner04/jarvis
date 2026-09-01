# Review and review-debate mutating passes each get their own commit

## Problem

`finalizeStandardReviewStep` and `reviewDebateResultOutcome` record only the latest mutating pass for terminal publication. The workflow-completion tail stamps one `review n` or `review-debate n` commit at the end, folding earlier mutating passes into that single terminal commit.

## Surface

`v2/src/execution/workflow-runner.ts` (standard review and review-debate step execution and completion publication), `v2/src/execution/review-debate.ts`, `v2/src/execution/completion-commit.ts` (per-pass commit inputs), and co-located tests.

## Decision ledger

- Each debate cycle whose actuator produces file changes gets its own completion commit with `Jarvis-Step: review-debate <n>` and that pass's actuator `Jarvis-Agent`; rules out deferring all debate edits to one terminal review-debate commit.
- Each light `review` cycle whose actuator produces file changes gets its own completion commit with `Jarvis-Step: review <n>` and that pass's actuator `Jarvis-Agent`; rules out deferring multi-pass light review to `lastMutatingReviewPass` at the terminal tail only.
- Non-mutating review or debate passes (critic approval with no actuator edits) add no commit; rules out empty marker commits per pass.
- Terminal publication commits only when the final boundary still has uncommitted changes; rules out a redundant terminal commit that restages already-committed pass edits.

## Task checklist

- Commit each mutating review-debate pass at the boundary where its edits settle, before later passes run, using the existing completion committer with the correct pass number and actuator agent.
- Commit each mutating light `review` pass the same way in `finalizeStandardReviewStep` (or equivalent boundary), before later passes run.
- Stop relying on `lastMutatingReviewPass` alone at terminal publication to represent all review or debate edits.
- Add a `workflow-runner-publication.test.ts` regression that drives implement publication with multi-pass debate review and asserts each mutating pass yields its own `review-debate n` commit ahead of base with the correct `Jarvis-Agent`.
- Add a `workflow-runner-publication.test.ts` regression that drives implement publication with multi-pass light review and asserts each mutating pass yields its own `review n` commit ahead of base with the correct `Jarvis-Agent`.

## Acceptance criteria

- [x] `workflow-runner-publication.test.ts` test `multi-pass review-debate retains one commit per mutating pass` fails when debate passes collapse to one terminal review commit and passes after the fix.
- [x] `workflow-runner-publication.test.ts` test `multi-pass light review retains one commit per mutating pass` fails when review passes collapse via `lastMutatingReviewPass` at the terminal tail and passes after the fix.
- [x] `review-debate.test.ts` stays green.
- [x] `bun run typecheck` passes.
- [x] `bun run test:v2` passes.

## Documentation updates

Deferred to [04 - Document per-turn publication commit history](./04-publication-commit-history-docs.md).
