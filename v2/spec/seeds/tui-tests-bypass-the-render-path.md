# TUI tests can be green while the TUI is broken

The status-color work shipped with a full passing suite and rendered no color at
all. The gate could not have caught it, because no TUI test drives ink.

## Problem

`loadInkUi`'s production wrapper was:

```ts
Text: ({ children }) => createElement(ink.Text, null, children),
```

It destructured only `children` and passed `null` props, so the `color` prop the
monitor computed was discarded before reaching ink. Fixed on `main`
(`fix/ink-seam-drops-props`, #1401).

The defect survived because **every TUI test substitutes its own `Text`**. The
color test builds elements with an injected `Text`, asserts `color` on the
resulting React element props, and passes — proving that `createMonitorDisplay`
computes the right tone, and nothing about whether the app renders it. The test
file says so in a comment: *"Ignores the real element `openInkMonitor` passes and
rebuilds the tree via `createMonitorDisplay`."*

So the seam between "our code" and "ink" is exactly where the bug lived and
exactly where no test looked. Any future TUI defect in that seam — dropped props,
wrong element type, a stale `Box` — is equally invisible.

This is a **gate blind spot**, not a one-off bug. It rhymes with
`run-cannot-report-complete-over-red-gate`: in both cases the harness verified a
pure function and declared the feature done.

## Scope

- At least one test per TUI surface that renders through **real ink** and asserts
  on output, not on element props of an injected stand-in. `ink-testing-library`
  (or ink's own `render` to a string) gives frame text; ANSI color codes are
  assertable in the frame.
- Cover the seam specifically: production `loadInkUi()` with no injected render.
  `tui-ink-runtime.test.ts` (added with the fix) is the minimal version — extend
  the idea to the monitor and log-follow surfaces.
- Keep the fast injected-seam tests. This adds a thin real-render layer; it does
  not replace unit coverage.

## Decisions

- The rule to encode: **a rendering change needs a test that renders.** Asserting
  props on an element you constructed proves your constructor, not your renderer.
- Prefer one real-render smoke test per surface over exhaustively re-testing every
  case through ink — slow, and the unit tests already cover the matrix.

## Out of scope

- The color bug itself (fixed, #1401).
- Interactive keypress coverage — that is `tui-row-navigation`'s subspec 00,
  which touches this same seam and should be reconciled with whatever lands here.

## Documentation updates

- `v2/docs/test-writing.md` — the render-through-ink rule for TUI surfaces.
