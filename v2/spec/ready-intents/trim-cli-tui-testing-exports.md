---
name: trim-cli-tui-testing-exports
---

# Trim CLI, TUI, and testing public surface

Drop `export` where symbols have no reference outside their file; delete outright if unused internally. Scope: `cli.ts` (`Io`) · `agent-model-config` (`EXECUTABLE_ROLES`, `ExecutableRole`) · `testing/bindings` (`SimulatedOutcome`) · `tui` (`TuiDaemonHealthResult`, `TuiDaemonStatusResult`, `TuiDaemonStartResult`, `TuiDaemonRpcTransport`). No behavior change beyond visibility.

## Decisions

- De-export or delete listed symbols only — rules out refactors or new public seams.
- TUI daemon client types stay internal unless referenced outside `tui/` — rules out preserving exports for hypothetical external consumers.

## Prerequisites

- v2 lean documentation-standard and in-process daemon-test defaults are landed (seed 01)

## Documentation updates

- None — internal visibility trim with no operator-facing behavior change

## Verification

- `bun run typecheck`, `test:v2`, `test:integration:v2`
