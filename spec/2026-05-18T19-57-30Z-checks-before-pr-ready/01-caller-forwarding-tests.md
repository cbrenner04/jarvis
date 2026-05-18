# 01 — Caller forwarding tests

## Problem

After subspec 00 enriches the error thrown by the default `markReady` implementation, there are
no unit tests that verify either the function-level propagation of multi-line error messages or
the caller-level forwarding to output channels. The `markReady` test seam makes the
function-level propagation straightforward to cover without spawning a real process.

For the plan-mode caller (`safeMarkPlanPrReady` in `src/commands/plan.ts:1870`), the function is
currently private with no `markReady` seam of its own — so it cannot be tested directly without a
small refactor to expose the seam.

For the patch-mode caller (the catch block in `src/modes/patch/run.ts:1185`), no test file or
harness exists for the run loop at unit-test level; caller tests for that path are out of scope.

## Decisions

- Function-level propagation tests live in the existing files `test/modes/patch/pr.test.ts` and
  `test/modes/plan/pr.test.ts`. Update (or extend) existing error-propagation tests there to use
  a multi-line message, verifying the full string is preserved.
- For the plan-mode caller, add a `markReady` option to `safeMarkPlanPrReady` (passed through to
  `maybeMarkPlanPrReady`) and export the function from `src/commands/plan.ts` so it can be tested
  directly in `test/plan-command.test.ts` using the existing `captureIo()` helper.
- For the patch-mode run.ts caller, no test infrastructure exists; these tests are out of scope
  for the unit test layer.
- Unit tests for the Node.js error-property extraction inside the default `markReady` impl
  (the `Buffer.stdout`/`Buffer.stderr` path) are out of scope — integration / manual testing
  covers that path.

## Tasks

- [ ] In `test/modes/patch/pr.test.ts`, update the existing "propagates errors from markReady"
  test (inside the `maybeMarkReady` describe block) to use a multi-line error message (e.g.
  `"bun run ready failed:\nsrc/foo.ts(1,1): error TS2345: ...\nFound 1 error."`) and assert the
  full multi-line string is preserved in the thrown error.

- [ ] In `test/modes/plan/pr.test.ts`, update the existing error-propagation test (inside the
  `maybeMarkPlanPrReady` describe block, currently titled "does not throw when markReady throws"
  — the title is incorrect, the test asserts `.toThrow`). Rename it to `"propagates errors from
  markReady"` to match the patch-mode equivalent, switch the thrown message to a multi-line string
  (e.g. `"bun run ready failed:\nsrc/foo.ts(1,1): error TS2345: ...\nFound 1 error."`), and
  assert the full multi-line string is preserved in the thrown error.

- [ ] In `src/commands/plan.ts`, export `safeMarkPlanPrReady` and add an optional `markReady`
  parameter to its options type, passing it through to `maybeMarkPlanPrReady`:

  ```ts
  export function safeMarkPlanPrReady(args: {
    io: PlanIo;
    branch: string;
    worktreePath: string;
    markReady?: (branch: string, cwd: string) => void;
  }): void {
    try {
      maybeMarkPlanPrReady({
        branch: args.branch,
        cwd: args.worktreePath,
        markReady: args.markReady,
      });
    } catch (err) {
      args.io.stderr(
        `warning: could not mark PR ready for review: ${(err as Error).message}\n`,
      );
    }
  }
  ```

- [ ] In `test/plan-command.test.ts`, using the existing `captureIo()` helper, add a test that
  calls `safeMarkPlanPrReady` directly with a `markReady` seam that throws an error whose message
  contains a multi-line string, and asserts that `io.stderr` received the full warning including
  the embedded multi-line output.

- [ ] Run `bun run test` to confirm all new and existing tests pass.

## Acceptance criteria

- [ ] A test in `test/modes/patch/pr.test.ts` asserts that a multi-line error message thrown by
  the `markReady` seam propagates out of `maybeMarkReady` with its full message intact.
- [ ] The test in `test/modes/plan/pr.test.ts` is renamed to `"propagates errors from markReady"`
  and asserts that a multi-line error message thrown by the `markReady` seam propagates out of
  `maybeMarkPlanPrReady` with its full message intact.
- [ ] `safeMarkPlanPrReady` is exported from `src/commands/plan.ts` and accepts an optional
  `markReady` seam parameter.
- [ ] A test in `test/plan-command.test.ts` asserts that when `markReady` throws an error with
  embedded multi-line check output, `io.stderr` receives the complete warning string including all
  embedded lines.
- [ ] `bun run test` passes with no failures.
