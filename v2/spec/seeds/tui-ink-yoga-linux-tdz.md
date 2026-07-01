---
name: tui-ink-yoga-linux-tdz
---

# TUI Ink/Yoga Linux startup race

## Problem

`jarvis tui` production startup can fail on Linux/Bun with
`Cannot access 'Yoga' before initialization` when Ink 7 imports `yoga-layout` 3.
Observed during #889 CI while TUI scaffold tests imported Ink transitively.

## Scope

- Make the production `jarvis tui` Ink path reliable on Linux/Bun.
- Keep tests from loading Ink unless the test is explicitly covering the
  production renderer.
- Preserve the existing injectable view-host pattern for TUI unit tests.

## Out of scope

- Replacing Ink as the TUI renderer.
- Reworking non-TUI daemon IPC behavior.

## Decisions (seed-level)

- The fix must cover the production entry path, not only tests.
- Prefer dependency/import isolation over broad test skips.
- Add a Linux/Bun regression check if it can run hermetically in CI.

## Documentation updates

- `v2/docs/v2-architecture.md` - note any durable renderer boundary decision.
- `v2/docs/daemon-host.md` - update only if TUI startup requirements change.
