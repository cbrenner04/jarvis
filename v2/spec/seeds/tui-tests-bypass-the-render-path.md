---
name: tui-tests-bypass-the-render-path
---

# TUI tests bypass the render path, and the ones that don't fail on CI

## Problem

`v2/docs/operator-runbook.md` § Gate trust has cited this seed by name for some time, but no
seed file exists. The gap is real and now has evidence.

Almost every TUI test asserts through a fake `TuiViewHost` and production `monitorTextLines`,
never through ink itself — so a TUI change can be green while ink rendering is broken. The
runbook already says this. What was not known until 2026-07-31 is the other half:

**A test that does drive real ink cannot pass on CI.** `tui-entry.test.tsx`'s
`drives workflow expansion through the injected input hook` rendered through `ink.render` into a
`Writable` with `isTTY = true` and asserted on the painted frame. It passed locally on every
attempt and failed on the GitHub runner with `Received: ""` — ink never paints to that fake
stdout there. Two flush-drain fixes were tried and both failed, because it is not a timing
problem. The test was admin-merged over a red check (#2417) and reddened `main`; recovery was
#2418, which moved the proof off painting entirely:

- the `e` keybinding is pinned in `tui-ink-monitor.test.tsx` through the injected input hook
  (no painting involved), and
- the control body is pinned in `tui-entry.test.tsx` through production monitor state.

So the repo currently has **no** way to assert real rendered output, and an author who tries
gets a test that is green locally and red on CI — the worst failure shape.

## Decisions

- The repo gains one supported way to assert real ink output that works on CI — either a
  headless render harness ink will paint into (e.g. a pty, or ink's own test renderer) or an
  explicit, documented decision that rendered-output assertions are out of scope. Rules out the
  current state, where the answer is undiscoverable until CI fails.
- If a harness is viable, at least one real render assertion covers the monitor table, so a
  broken ink tree fails a test — rules out shipping the harness with no consumer.
- If rendered-output assertions are ruled out instead, `v2/docs/test-writing.md` says so
  explicitly and names the substitute (injected input hook for bindings, production monitor
  state for behavior) — rules out leaving authors to rediscover it.
- The runbook's existing "TUI tests can pass while ink rendering is broken" warning gains the
  CI half: a test that drives real ink is green locally and red on CI. Rules out documenting
  only the first failure mode.
- Out of scope: rewriting existing TUI tests that already assert through production state.

## Acceptance criteria

- [ ] A decision is recorded in `v2/docs/test-writing.md`: either the supported real-render
      harness, or an explicit statement that rendered-output assertions are unsupported plus the
      named substitutes.
- [ ] If a harness ships: a test asserts real rendered monitor-table output and passes in CI
      (verified on a CI run, not only locally); breaking the ink tree — e.g. rendering an empty
      fragment in place of the table — turns it RED.
- [ ] If a harness is ruled out: a fixture or lint-style check makes an ink-painting assertion
      fail fast with a message pointing at the substitute, so the failure is local rather than
      CI-only.
- [ ] `v2/docs/operator-runbook.md` § Gate trust states both failure modes and links this seed's
      outcome; the dangling seed reference is resolved.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/test-writing.md` — how to assert TUI behavior, and what is not assertable.
- `v2/docs/operator-runbook.md` § Gate trust — replace the one-line warning with both modes.

## Prerequisites

- `v2/src/tui/tui-entry.test.tsx` fake `TuiViewHost` and `monitorTextLines` assertions
- `v2/src/tui/tui-ink-monitor.test.tsx` injected-input-hook pattern
- #2418, which moved the one real-ink assertion off painting
