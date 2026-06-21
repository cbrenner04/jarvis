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
- The convention bars agent-runnable tests from spawning real OS processes or depending on
  wall-clock/scheduler timing; require DI seams (injected process tables, injected clocks/pollers)
  instead — rules out a vaguer "avoid flaky tests" note that gives no enforceable pattern.
- Cite the #15 `DescendantTracker` `listProcesses`/`kill` injection as the worked example — rules
  out describing the pattern abstractly with no concrete reference an author can copy.

## Task checklist

- [ ] Add the convention to `v2/docs` (in or linked from `coding-standards.md`).
- [ ] State the two bars (no real-process spawning, no wall-clock/scheduler timing) and the seam
      requirement, citing the #15 pattern.

## Acceptance criteria

- [ ] `v2/docs` records a standing convention that agent-runnable tests must not spawn real OS
      processes or depend on wall-clock/scheduler timing, and must use dependency-injection seams
      (injected process tables, injected clocks/pollers) instead.
- [ ] The convention cites the #15 `DescendantTracker` `listProcesses`/`kill` injection
      (`v1/src/modes/patch/reap.ts`) as the pattern to follow.
- [ ] The convention is discoverable from `v2/docs/coding-standards.md` (stated inline or via a
      link to a dedicated test-writing doc).

## Documentation updates

- `v2/docs/coding-standards.md` (and/or a new linked test-writing doc under `v2/docs`): the
  convention itself is the deliverable. No `v1-behaviors.md` change — net-new guidance, no change
  to existing v1 functionality.
