# 00 - Inject review-debate progress map into handler factory

`reviewDebateProgressByInvocation` is a module-global mutable `Map` exported from
`v2/src/daemon/daemon.ts`, read by `workflowStepSnapshot` and written by the exported
`reportReviewDebateProgress`. `daemon-start-list.test.ts` imports both directly and clears
the map in its own `afterEach`. Scope the map to each `createRunControlHandlers` call
instead, so handler instances don't share mutable state and tests don't need manual
clearing.

## Decisions

- `createRunControlHandlers` creates its own `reviewDebateProgressByInvocation` map
  internally (one per call) instead of reading the module-global.
- `reportReviewDebateProgress` becomes part of the object `createRunControlHandlers`
  returns (bound to that instance's map), not a standalone export.
- Remove the `reviewDebateProgressByInvocation` and `reportReviewDebateProgress` exports
  from `daemon.ts`.
- `daemon-start-list.test.ts` updates only its imports and the review-debate test cases to
  call the handlers-returned `reportReviewDebateProgress` instead of the removed exports,
  and drops the now-unneeded `afterEach` map-clear. No other test in this file changes in
  this subspec — the socket harness stays in place until 01.

## Out of scope

- Converting any test case to direct handler invocation (01).
- Any other caller of `createRunControlHandlers`.

## Acceptance criteria

- [x] `daemon.ts` exports no `reviewDebateProgressByInvocation` or module-level
      `reportReviewDebateProgress`; both are scoped inside `createRunControlHandlers`.
- [x] `daemon-start-list.test.ts` passes with 0 skips in the agent sandbox, using the
      handlers-returned `reportReviewDebateProgress` in place of the removed exports.
- [x] Two `createRunControlHandlers` instances track review-debate progress
      independently (no shared state leaks between instances).

## Documentation updates

- None — `reviewDebateProgressByInvocation` and `reportReviewDebateProgress` are internal
  `daemon.ts` symbols with no operator-facing behavior; the code comments at their
  definition site already describe the scoping and move with the code.
