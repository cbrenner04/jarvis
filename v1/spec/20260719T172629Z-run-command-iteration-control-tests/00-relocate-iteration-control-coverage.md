# Relocate iteration-control coverage

## Problem

`v1/test/run.test.ts` holds run-command iteration-control coverage mixed with
unrelated suites. Three describe blocks form a cohesive iteration-control
group:

- `loop-only mode (git: false)` (currently `run.test.ts` ~4856)
- `timeout behavior` (currently `run.test.ts` ~5025)
- `blocker handling` (currently `run.test.ts` ~5715)

Move them verbatim into a dedicated `v1/test/run-command-iteration-control.test.ts`,
matching the existing `run-command-*.test.ts` partition pattern.

## Decisions

- Target file `v1/test/run-command-iteration-control.test.ts` — matches sibling `run-command-routing.test.ts` naming; rules out an ad-hoc name.
- Move only the three named describe blocks; leave every other suite in `run.test.ts` — rules out sweeping adjacent suites in the same edit.
- Behavior-preserving: relocate assertions and their supporting helpers/imports unchanged; no assertion edits — rules out "tidying" the moved tests.
- New file carries its own copy of shared harness helpers (`captureIo`, `FakeAgent`, fixtures) like the other partitions — rules out extracting a shared module in this partition.
- `agent stream handling (regression test for hang)` stays in `run.test.ts` — rules out moving stream-settlement regressions with the timeout block.

## Out of scope

- Changing run-command production behavior.
- `v1/test/run.sandbox-unrunnable.test.ts` process-backed timeout coverage — stays as-is.
- Review-phase and `--resume-review` coverage.

## Task checklist

- Create `v1/test/run-command-iteration-control.test.ts` with the three blocks and their helper/import prelude.
- Delete the three blocks from `run.test.ts`.
- Confirm no other suite or helper referenced only by those blocks is left dangling.

## Acceptance criteria

- [ ] `v1/test/run-command-iteration-control.test.ts` contains the `loop-only mode (git: false)`, `timeout behavior`, and `blocker handling` describe blocks and passes.
- [ ] Those three describe blocks are no longer present in `v1/test/run.test.ts`, and `run.test.ts` stays green.
- [ ] The `agent stream handling (regression test for hang)` describe block remains in `v1/test/run.test.ts`.
- [ ] `v1/test/run.sandbox-unrunnable.test.ts` is unchanged and stays green.
- [ ] Total `test(` count across `run.test.ts` + `run-command-iteration-control.test.ts` after the move equals the pre-move `run.test.ts` `test(` count (no assertions dropped or added).
- [ ] `bun run typecheck` passes.

## Documentation updates

None — test-only behavior-preserving partition; no production behavior or operator semantics change.
