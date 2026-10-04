---
name: tui-ink-renderer-isolation
---

# TUI ink renderer isolation

Production `jarvis tui` ink surfaces load reliably on Linux/Bun without `Cannot access 'Yoga' before initialization`, and co-located TUI flow tests do not transitively evaluate `ink`/`yoga-layout` unless explicitly covering the production renderer.

## Decisions

- Fix production ink entry paths (`jarvis tui`, `jarvis tui log`, launch field collection), not test-only workarounds — rules out CI green via skipped TUI tests alone.
- Centralize production ink/yoga loading behind one lazy import boundary — rules out top-level `import "ink"` (or equivalent eager evaluation) in modules on default test import graphs.
- Route all production ink load sites through that boundary — rules out duplicate `import("ink")` in `tui-field-collector` or sibling modules that bypass it.
- Prefer import/dependency isolation over broad `test.skip` or excluding TUI tests from CI — rules out hiding the Yoga TDZ instead of fixing load order.
- Co-located TUI flow tests default to injectable `viewHost`/`inkRender` seams — rules out live-terminal-only coverage and rules out removing existing injection hooks.
- Preserve public `inkRender`/`viewHost` seams on every shipped ink surface — rules out collapsing unit tests onto production ink rendering.
- Deferred to first consumer: alternate TUI renderer stack — pin when replacing Ink.

## Prerequisites

- Shipped `jarvis tui` run monitor with injectable `viewHost` and `inkRender` test seams.
- Shipped `jarvis tui log <run-id>` with injectable ink render test seam.
- Shipped TUI launch field collection with injectable `inkRender` test seam.

## Documentation updates

- `v2/docs/v2-architecture.md` — durable ink renderer lazy-load boundary and what modules must not eagerly import ink.
- `v2/docs/daemon-host.md` — only if TUI startup ordering or daemon prerequisites change.
- `v2/docs/v1-behaviors.md` — record corrected Linux/Bun TUI ink startup behavior when this ships.
