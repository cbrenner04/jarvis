# Derive v2 integration slice, drop the maintained literal

## Problem

`test/test-slices.test.ts`, in the test `"test:v2 and test:integration:v2
enumerate disjoint v2 test file sets"`, pins the v2 integration slice to a
hardcoded literal array of ten `*.sandbox-unrunnable.test.ts` paths. Any branch
adding a v2 integration test must hand-edit that array, and two branches each
adding one conflict on merge. Observed 2026-07-12: this assertion red-lit CI on
three PRs in one session, none a real defect.

The v1 slice test in the same file already uses the derived-partition pattern
this change wants; only the v2 case carries the brittle literal.

## Decisions

- Replace the literal `expect(integration).toEqual([...ten paths...])` with the
  derived-partition assertions the v1 slice test already uses — membership comes
  from `isSandboxUnrunnable`, not a maintained list. Rules out: keeping the
  literal but regenerating it from a script (still an edit per added file, so it
  does not satisfy "no edit").
- Keep the load-bearing assertions: `[...agent, ...integration].sort()` equals
  the on-disk v2 roster (`walkV2TestFiles()`), agent files are all
  non-sandbox-unrunnable, integration files are all sandbox-unrunnable,
  integration is non-empty. Keep the sibling assertions in the same test
  unchanged (`test:v2`/`test:integration:v2` script bodies, runner `spawn`
  shape).
- No tripwire literal is retained. The intent permits one only if it states its
  snapshot intent in the failure message; a plain derived partition is simpler
  and needs no per-file maintenance.

## Task checklist

- Rework the v2 slice test to assert the derived partition instead of the literal
  array.
- Update `v2/docs/test-writing.md` to state that adding a v2
  `*.sandbox-unrunnable.test.ts` test requires no roster edit.

## Acceptance criteria

- [ ] `test/test-slices.test.ts` contains no hardcoded list of
  `*.sandbox-unrunnable.test.ts` paths; the v2 integration slice's membership is
  derived via `isSandboxUnrunnable` (grep for the daemon sandbox-unrunnable path
  literals returns nothing).
- [ ] The v2 slice test asserts, without naming any specific file: agent files
  are all non-sandbox-unrunnable, integration files are all sandbox-unrunnable,
  integration is non-empty, and `[...agent, ...integration].sort()` equals
  `walkV2TestFiles()`.
- [ ] A test drives `sliceTestFiles` (or `partitionTestFiles`) over a file list
  containing a synthetic new `foo.sandbox-unrunnable.test.ts` path and asserts it
  routes to the integration slice while a plain `*.test.ts` sibling routes to
  agent — documenting that integration membership follows the filename
  convention, the derivation the reworked v2 slice test now relies on.
- [ ] `test/test-slices.test.ts` stays green, with the v1 slice test and the
  sibling `test:v2`/`test:integration:v2` script-body and runner-`spawn`
  assertions unchanged.
- [ ] `v2/docs/test-writing.md` states that adding a v2 sandbox-unrunnable
  (integration) test requires no edit to the slice-boundary test.

## Documentation updates

- `v2/docs/test-writing.md` — under the v2 run-command routing section, note the
  integration slice is derived from the filename convention, so adding a
  `*.sandbox-unrunnable.test.ts` file needs no roster edit.
