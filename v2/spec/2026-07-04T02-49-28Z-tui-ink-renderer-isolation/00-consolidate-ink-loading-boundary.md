# Consolidate ink loading onto the shared lazy boundary

`tui-ink-monitor.tsx`, `tui-ink-log-follow.tsx`, and `tui-ink-feedback.tsx` already load ink through the shared `loadInkUi` boundary in `tui-ink-runtime.ts`. `tui-field-collector.tsx` bypasses it with its own inline `await import("ink")`, and has no co-located test — the last production ink entry path that isn't isolated behind the lazy boundary or covered by an injectable test seam.

## Decisions

- `collectLaunchFieldsViaInk` loads ink via `loadInkUi`, not its own `import("ink")` — rules out a second, divergent ink-loading path in the same package.
- `loadInkUi` already exports `renderFn`, `Text`, and optional `useInput`/`Box` (see `tui-ink-runtime.ts`) — this subspec adds no new fields to that surface; it only replaces `tui-field-collector.tsx`'s inline `import("ink")` + local `Text`/`useInput` extraction with calls into the existing boundary.
- Causal mechanism: a second independent `await import("ink")` call site duplicates the one place known to avoid the Yoga TDZ (a single lazy dynamic import, never a top-level/eager one — see intent Decision "Centralize production ink/yoga loading"). The three already-migrated surfaces validated that fix; consolidating the last call site applies the identical, already-proven pattern rather than introducing a new one.
- Full Linux/Bun CI regression coverage of the TDZ fix is out of scope here — that's the sibling ready-intent `tui-ink-linux-bun-regression-ci`. This subspec adds one direct smoke test (below) as its own proof the consolidated path doesn't regress.
- `viewHost` is not applicable to this subspec: `tui-field-collector.tsx` has no `viewHost` wrapper today (only the `inkRender` seam via `TuiLaunchFieldCollector`), unlike `tui-entry.tsx`/`tui-log-follow-entry.tsx`. This change doesn't touch any `viewHost`-bearing entry point, so no `viewHost` seam is added or altered.
- Add a co-located `tui-field-collector.test.tsx` using the existing injectable `inkRender` seam — rules out this entry path staying untested or gaining live-terminal-only coverage.

## Acceptance criteria

- [ ] `collectLaunchFieldsViaInk` in `tui-field-collector.tsx` obtains its render function, `Text`, and `useInput` from `loadInkUi` instead of a direct `import("ink")`.
- [ ] `tui-field-collector.test.tsx` exists, drives `collectLaunchFieldsViaInk` through an injected `inkRender` seam, and asserts field collection completes: since ink's real `render()` needs a TTY unavailable in the test harness, any accidental fallthrough to the real `import("ink")` path would hang or throw rather than pass silently.
- [ ] No file under `v2/src/tui/` contains a static top-level `ink` import, a `require("ink")` call, or a re-export of ink bound at module scope; `tui-ink-runtime.ts` is the only file with a dynamic `import("ink")` call.
- [ ] A smoke test calls `loadInkUi()` with no `inkRender` argument (real `import("ink")`, real yoga-layout init) and asserts it resolves without throwing, giving direct signal on the consolidated path wherever `bun test` runs.
- [ ] `bun test v2/src/tui/` passes with no new failures.

## Documentation updates

- `v2/docs/v2-architecture.md` — record `loadInkUi` as the durable, sole ink/yoga-layout load site for the TUI host, and the rule that no other `v2/src/tui/` module may import `ink` directly (statically, via `require`, via re-export, or via a second dynamic call site).
- `v2/docs/v1-behaviors.md` — record that launch field collection now loads ink through the same lazy boundary as the run monitor and log-follow views; full Linux/Bun CI regression coverage of the underlying TDZ fix lands via the sibling `tui-ink-linux-bun-regression-ci` intent.
