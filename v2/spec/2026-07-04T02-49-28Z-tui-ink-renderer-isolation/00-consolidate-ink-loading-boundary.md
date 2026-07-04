# Consolidate ink loading onto the shared lazy boundary

`tui-ink-monitor.tsx`, `tui-ink-log-follow.tsx`, and `tui-ink-feedback.tsx` already load ink through the shared `loadInkUi` boundary in `tui-ink-runtime.ts`. `tui-field-collector.tsx` bypasses it with its own inline `await import("ink")`, and has no co-located test — the last production ink entry path that isn't isolated behind the lazy boundary or covered by an injectable test seam.

## Decisions

- `collectLaunchFieldsViaInk` loads ink via `loadInkUi`, not its own `import("ink")` — rules out a second, divergent ink-loading path in the same package.
- `loadInkUi` in `tui-ink-runtime.ts` remains the sole dynamic `import("ink")` call site under `v2/src/tui/` — rules out any module reintroducing a duplicate or static top-level ink import.
- Add a co-located `tui-field-collector.test.tsx` using the existing injectable `inkRender` seam — rules out this entry path staying untested or gaining live-terminal-only coverage.

## Acceptance criteria

- [ ] `collectLaunchFieldsViaInk` in `tui-field-collector.tsx` obtains its render function, `Text`, and `useInput` from `loadInkUi` instead of a direct `import("ink")`.
- [ ] `tui-field-collector.test.tsx` exists and drives `collectLaunchFieldsViaInk` through an injected `inkRender` seam, asserting field collection completes without loading production ink.
- [ ] No file under `v2/src/tui/` contains a static top-level `ink` import; `tui-ink-runtime.ts` is the only file with a dynamic `import("ink")` call.
- [ ] `bun test v2/src/tui/` passes with no new failures.

## Documentation updates

- `v2/docs/v2-architecture.md` — record `loadInkUi` as the durable, sole ink/yoga-layout load site for the TUI host, and the rule that no other `v2/src/tui/` module may import `ink` directly (statically or via a second dynamic call site).
- `v2/docs/v1-behaviors.md` — record that launch field collection now loads ink through the same lazy boundary as the run monitor and log-follow views, closing the prior isolation gap.
