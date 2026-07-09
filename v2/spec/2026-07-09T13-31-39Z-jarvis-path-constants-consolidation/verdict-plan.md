Verdict: uphold both findings; refine the spec to add direct test coverage for `paths.ts`.

Required refinements:

1. **Add a Task Checklist item** to create `v2/src/paths.test.ts` asserting the exact literal values of all four exported constants (`DAEMON_SOCKET_PATH`, `DAEMON_PID_PATH`, `MACHINE_CONFIG_PATH`, `DAEMON_SOCKET_DISPLAY`). Without this, a typo replicated consistently across call sites (e.g., `daemon.sock` misspelled the same way everywhere) would pass all existing downstream tests undetected — the whole point of this consolidation is a single source of truth, and that source needs its own pin.

2. **Add a matching Acceptance criterion** for `paths.test.ts` asserting the four constants' values.

3. This single new test file resolves the display-string gap too: `DAEMON_SOCKET_DISPLAY`'s literal value gets pinned directly, so no separate `tui-daemon-errors.test.ts` is needed — `tui-daemon-errors.ts` only re-exports it under the existing name `TUI_DAEMON_SOCKET_DISPLAY`, and that re-export is already covered by the existing AC that its current tests stay green.

Rationale: the intent's core motivation is preventing silent path divergence ("A path typo in one site would silently diverge from the others"). As drafted, the spec verifies only that call sites *consume* `paths.ts` correctly, not that `paths.ts` itself holds the *correct* values — leaving the stated risk only partially mitigated. A minimal, scope-bounded test on the new module (not new test infrastructure, not expanded scope beyond the four constants named in the intent) closes this gap.