- Split the oversized subspec into independently testable units: core aggregate work/idle projection (including tree, detail, formatter, and tick behavior), failed-before-start rendering, and finishless terminal-run timing. Preserve every original task and acceptance outcome exactly once across the replacements and link every replacement from `index.md`.

- Define a feasible tree layout contract. The current 8-character elapsed column cannot display combined work/idle text or `failed before start`. Specify the intended width behavior and require width-specific regressions.

- Define an explicit pipeline-state mapping for active, parked, and terminal rows. Resolve whether `pending` shows idle; treating it as running currently conflicts with the intent. Apply the same active-execution idle policy consistently to tree and detail so idle does not masquerade as operator wait while work is advancing.

- Make aggregate formatting behavior complete and testable: zero work, reversed/corrupt intervals, future activity, nonnegative clamping, precision, labels/separators, and width tiers. “Always show work” must not inherit the leaf formatter’s blank-zero behavior accidentally.

- Resolve the durability gap in last-activity computation. Capped/evicted terminal run rows cannot reliably supply all member finishes. Require either a durable complete source or explicitly specified and tested best-effort semantics under eviction.

- Fully define null-start stage behavior. Keep `failed before start` limited to failed stages, but state and test the presentation for skipped, interrupted, approval, malformed succeeded, and other non-failed null-start rows.

- Define finishless terminal-run fallback precisely as an admission fallback, including standalone rows with no member finish. Pin whether that produces blank or zero elapsed, and name the existing contradictory shell-layout test that must change.

- Require direct cross-surface coverage showing ordinary running and completed stage elapsed agree in the tree, pipeline roll-up, and selected-stage detail. Also test that pipeline detail omits idle when no durable activity exists.

- Complete mutation coverage for all added or modified guards, including aggregate-format boundaries, run attribution, and finish-versus-admission fallback. Each runtime-behavior subspec needs its own failing-baseline regression and exactly one linked keystone checkpoint, with every mutation directive tied to the named enclosing test.
