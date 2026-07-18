---
name: derive-integration-slice-roster
description: Adding a v2 integration test needs no edit to the slice-boundary test
---

# Adding a v2 integration test requires no slice-boundary test edit

`test/test-slices.test.ts` pins the v2 integration slice to a hardcoded literal
array of `*.sandbox-unrunnable.test.ts` paths. Every branch adding an integration
test must hand-edit that array, and two parallel branches each adding one
conflict on merge. Observed 2026-07-12: this assertion red-lit CI on three PRs in
one session, none a real defect.

## Behavior

- Adding a new v2 `*.sandbox-unrunnable.test.ts` file requires no edit to
  `test/test-slices.test.ts`; the integration slice is derived from the filename
  convention, not a maintained literal.
- The load-bearing partition/disjointness assertions stay: `[...agent,
  ...integration].sort()` equals the on-disk v2 test roster, agent files are all
  non-sandbox-unrunnable, integration files are all sandbox-unrunnable, and the
  integration set is non-empty.
- If a literal roster is retained as a tripwire against accidentally marking a
  file sandbox-unrunnable, its failure message states that intent and the roster
  is a harness-updatable snapshot, not a human-maintained literal.

## Out of scope

- The `sandbox-unrunnable` naming convention itself.
- CI test scoping (`scripts/ci-test-scope.ts`).

## Documentation updates

- `v2/docs/test-writing.md` — adding an integration (sandbox-unrunnable) test
  requires no roster edit.

## Prerequisites
