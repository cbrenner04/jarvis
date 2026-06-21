# Standing test-determinism convention

## Problem

The #15 stabilization (`2026-06-20T21-30-42Z-stabilize-flaky-process-timing-tests`) de-flaked two
specific tests by injecting a fixed process table / DI seams into `DescendantTracker` instead of
spawning real `perl` and polling wall-clock deadlines. That pattern is currently one-off. Tests
that spawn real processes also can't run in the coding agent's sandbox at all, so a stabilization
spec for them is un-runnable by the agent — it can only block. Generalize the #15 pattern into a
standing convention so new tests are written deterministic and sandbox-runnable from the start.

## Decisions

- Document the convention in `v2/docs`, discoverable from `coding-standards.md` (inline section or
  a linked test-writing doc) — rules out leaving it implicit or burying it only in the #15 spec,
  which would not catch future tests.
- Define "agent-runnable test" as the convention's scope: the default test class, expected to pass
  in the coding agent's sandbox — rules out leaving the boundary undefined and the convention
  unenforceable.
- Real-process / real-clock tests are the marked exception, not the default: such a test must carry
  an explicit marker (a filename/tag convention the doc pins) declaring it sandbox-unrunnable, so
  the real OS seams (`reap.ts` `listProcesses`/`kill`) still have exercising tests — rules out the
  convention banning all real-process coverage, which would leave those seams untested.
- The convention bars agent-runnable tests from spawning real OS processes or depending on
  wall-clock/scheduler timing; require DI seams (injected process tables, injected clocks/pollers)
  instead — rules out a vaguer "avoid flaky tests" note that gives no enforceable pattern.
- Cite the #15 `DescendantTracker` `listProcesses`/`kill` injection as the worked example — rules
  out describing the pattern abstractly with no concrete reference an author can copy.
- Automated enforcement (lint/review hook) is out of scope, deferred — rules out implying the
  "deterministic from the start" promise is mechanically enforced; it rests on authors reading the
  doc until a future enforcement spec.
- Converting the existing process-spawning tests that can't run in the sandbox is out of scope —
  this spec sets the convention for new tests; incremental conversion of existing tests inherits
  the #15 pattern as separate effort.

## Task checklist

- [ ] Add the convention to `v2/docs` (in or linked from `coding-standards.md`).
- [ ] Define "agent-runnable test" and pin the marker for the real-process/real-clock exception.
- [ ] State the two bars (no real-process spawning, no wall-clock/scheduler timing) and the seam
      requirement, citing the #15 pattern.
- [ ] State that automated enforcement and conversion of existing un-runnable tests are out of
      scope.

## Acceptance criteria

- [ ] `v2/docs` records a standing convention that agent-runnable tests must not spawn real OS
      processes or depend on wall-clock/scheduler timing, and must use dependency-injection seams
      (injected process tables, injected clocks/pollers) instead.
- [ ] The convention defines "agent-runnable test" (default, sandbox-runnable) and pins how a
      legitimate real-process/real-clock test is marked as the sandbox-unrunnable exception.
- [ ] The convention states that automated enforcement is out of scope (deferred) and that
      converting existing un-runnable process-spawning tests is out of scope.
- [ ] The convention cites the #15 `DescendantTracker` `listProcesses`/`kill` injection
      (`v1/src/modes/patch/reap.ts`) as the pattern to follow.
- [ ] The convention is discoverable from `v2/docs/coding-standards.md` (stated inline or via a
      link to a dedicated test-writing doc).

## Documentation updates

- `v2/docs/coding-standards.md` (and/or a new linked test-writing doc under `v2/docs`): the
  convention itself is the deliverable. No `v1-behaviors.md` change — net-new guidance, no change
  to existing v1 functionality.
