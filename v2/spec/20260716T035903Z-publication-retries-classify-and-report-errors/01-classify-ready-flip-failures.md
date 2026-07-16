# Classify ready-flip failures

Apply the completion publication retry policy and evidence-rich notices to `gh pr ready`.

## Decisions

- Reuse the completion publication retry policy for the ready flip; rules out a second classifier or divergent retry format.
- Evaluate `already ready` and `not a draft` success guards before classification; rules out treating lost-ack convergence as permanent failure.
- Leave ready-gate failures outside publication retry classification; rules out retrying test failures as transport failures.
- Leave ready-repair behavior, terminal-cause run-log persistence, workflow exit codes, and review-step logging unchanged; rules out widening finalization scope.

## Tasks

- Route ready-flip failures through the shared evidence-aware publication retry policy.
- Add focused permanent, transient, evidence-notice, and success-guard coverage.

## Acceptance criteria

- [ ] `v2/src/execution/ready-finalize.test.ts` gains regression cases that fail against the baseline and prove auth, permission, not-found, invalid-input, and unrecognized `gh pr ready` failures stop after one attempt without delay or retry notice.
- [ ] Evidenced transient `gh pr ready` failures retry up to three total attempts with 1000 ms backoff and notices containing the operation, next attempt, message, exit code, and available bounded stdout/stderr tails.
- [ ] `already ready` and `not a draft` command failures still succeed after one attempt without delay or retry notice; exit-0 remains success.
- [ ] Ready-gate failure still skips the flip and follows the existing `ReadyGateError` repair path; `v2/src/execution/ready-finalize.test.ts` and `v2/src/execution/write-loop-ready-repair.test.ts` stay green.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md`: document shared ready-flip classification, evidence-rich notices, permanent fast-fail behavior, and preserved success guards.
- `v2/docs/v1-behaviors.md`: align the v2 ready-finalization parity record and source citations.
