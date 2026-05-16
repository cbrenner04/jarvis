# 05 — Test-suite and tooling cleanups

## Problem

PR #30 added or updated several plan-mode test files, but the review
flagged some smaller cleanups (**#15** partial, **#46**) that don't
affect correctness and so were deferred:

- A few test files still construct ad-hoc git remotes inline rather
  than using the shared helpers in `test/helpers/`.
- `test/modes/plan/commits.test.ts` invokes `git interpret-trailers
  --parse` to verify trailer presence; this is robust but slow.
- The `PLAN_STUB_MESSAGE` constant in `src/commands/plan.ts` is still
  exported even though only one test uses it; consider inlining it
  into the test or moving it behind a `__test__` export pattern.
- No end-to-end test exercises the full plan-mode loop (interview →
  draft → reviews → PR open) against a fake agent. The existing tests
  cover each stage in isolation.

## Decisions

- **Promote ad-hoc remote setup into `test/helpers/plan-fixtures.ts`.**
  Add a `setupPlanRemote()` helper that returns `{ origin, worktreeRoot,
  cleanup }`. Migrate `test/modes/plan/{commits,blocker,prompts,pr}.test.ts`
  one by one to use it. No behavior change in any individual test.
- **Use `git log --format="%(trailers:key=Jarvis-Agent,valueonly)"` for
  trailer assertions.** This is faster than `interpret-trailers --parse`
  and more direct: the test asserts the trailer value rather than
  scanning a parsed structure.
- **Inline `PLAN_STUB_MESSAGE`.** The constant is consumed by exactly
  one test (`test/plan-command.test.ts`); inline the literal string
  there and delete the export. Update the test to match.
- **Add an end-to-end plan-mode test.** A new file
  `test/plan-end-to-end.test.ts` runs `planCommand` against a fake
  agent (the existing `FakeAgent` test double), confirms that the
  expected sequence of commits lands (`plan: interview`, `plan: draft`,
  `plan: review 1`, `plan: review 2`), confirms the draft PR was
  opened with the correct title and a body containing the index
  checklist mirror, and confirms the exit code is 0.

## Acceptance criteria

- [x] `setupPlanRemote()` helper exists and is consumed by all four
  existing plan-mode test files.
- [x] Trailer assertions use `git log --format=...
  trailers:key=Jarvis-Agent,valueonly`.
- [x] `PLAN_STUB_MESSAGE` is no longer exported from
  `src/commands/plan.ts`.
- [x] `test/plan-end-to-end.test.ts` exists and passes.
- [x] `bun run typecheck`, `bun test`, and `bun run check` all pass.

## Documentation updates

- No documentation changes; this spec is internal to the test suite.
