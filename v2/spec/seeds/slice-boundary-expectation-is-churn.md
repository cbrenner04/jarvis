# The slice-boundary expectation is merge churn

`test/test-slices.test.ts` asserts the integration slice equals a **hardcoded
literal array** of `*.sandbox-unrunnable.test.ts` paths. Every branch that adds one
must hand-edit that array, and two parallel branches that each add one invalidate
each other on merge.

## Problem

Observed 2026-07-12: this single assertion red-lit CI on **three** PRs in one
session, none of them a real defect:

- `responsive-daemon-git-admission` — merged `main`, but its copy of the array
  predated `responsive-completion-publication`'s new file.
- `plan-draft-write-loop-prompt` — same, behind two siblings' files.
- `nonblocking-ready-gate-and-guard` — added its own integration test and did not
  list it.

Each fix was a one-line array edit. The test caught nothing except its own
staleness.

The real invariant worth testing is the one the *other* assertion already covers:
`[...agent, ...integration].sort()` equals what is on disk — i.e. the two slices
partition the v2 test files with nothing dropped and nothing double-run. That is
derived and cannot go stale. The literal list adds no coverage over it; it only
pins *which* files are integration, which the filename convention
(`*.sandbox-unrunnable.test.ts`) already determines.

## Scope

- Drop the hardcoded array, or derive it from the filename convention so adding an
  integration test needs no test edit.
- Keep the partition/disjointness assertions — those are the load-bearing ones.
- If an explicit list is genuinely wanted as a tripwire against *accidentally*
  marking a file sandbox-unrunnable, make its failure message say so, and consider
  a snapshot the harness can update, not a literal a human maintains.

## Decisions

- The disjoint-partition property is the invariant; the file roster is an
  implementation detail of the naming convention.
- A test that must be edited by every unrelated branch is a merge-conflict
  generator, not a guard.

## Out of scope

- The `sandbox-unrunnable` naming convention itself.
- CI test scoping (`scripts/ci-test-scope.ts`).

## Documentation updates

- `v2/docs/test-writing.md` — how to add an integration (sandbox-unrunnable) test,
  once no roster edit is required.
