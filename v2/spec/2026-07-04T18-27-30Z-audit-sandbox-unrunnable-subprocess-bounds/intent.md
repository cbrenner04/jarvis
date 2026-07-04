---
name: audit-sandbox-unrunnable-subprocess-bounds
---

# Audit sibling sandbox-unrunnable tests for bounded subprocess cleanup

## Problem

The shrink file is not the only `*.sandbox-unrunnable.test.ts` suite with real
git subprocesses or imported hang fixtures, so the same unbounded-stall pattern
may still survive elsewhere after the first fix.

## Direction

Audit sibling patch `*.sandbox-unrunnable.test.ts` files for unbounded git
subprocesses and unreaped hang fixtures, then align them with the bounded-fail
pattern or prove the remaining call sites are already bounded.

The observable result is: no sibling sandbox-unrunnable test can block the CI
job indefinitely on the same subprocess-or-fixture pattern.

## Decisions

- Audit sibling sandbox-unrunnable suites after the shrink-path fix establishes the bounded pattern — rules out bundling every test file into one wider first change.
- Harden only matching subprocess and fixture-stall paths — rules out opportunistic refactors in unrelated test helpers.
- Reuse the established bounded execution and reap pattern where possible — rules out per-file bespoke timeout behavior that drifts across the suite.

## Documentation updates

- `v2/docs/v1-behaviors.md` — sibling sandbox-unrunnable test suites use bounded subprocess cleanup where required.

## Prerequisites

- Shrink sandbox-unrunnable stalls fail as bounded test failures instead of hanging the CI job

## Blocker

Prerequisite "Shrink sandbox-unrunnable stalls fail as bounded test failures instead of hanging the CI job" is not yet confirmed in the target repo. The referenced spec (`v1/spec/2026-07-04T16-43-58Z-bound-shrink-sandbox-unrunnable-stalls/00-bound-shrink-sandbox-unrunnable-stall-cleanup.md`) is merged to `main` but only as a plan — its Task checklist and Acceptance criteria are all unchecked, and `v1/test/modes/patch/shrink.sandbox-unrunnable.test.ts` has no implementation commit since #926 (predates the plan). The bounded-fail pattern this audit is meant to align siblings with does not exist in code yet. Resolve by landing that implementation first, then re-run this intent.
