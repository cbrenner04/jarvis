# Milestone 2 milestone-2-runtime-surfaces

Expose published plan paths through the runtime.

## Decisions

- Published plan paths are owned by persistence until shipped.
- Daemon RPC must validate plan requests before dispatch.
- The command-line entrypoint prints the published plan path.
- Runtime surfaces must remain independently testable.

## Acceptance criteria

- [ ] SQLite storage retains the published plan path.
- [ ] Daemon RPC rejects a malformed plan request.
- [ ] The CLI prints the published plan path.

## Documentation updates

- Document SQLite plan-path storage in persistence docs.
- Document daemon RPC validation in operator runbook.
- Document CLI plan-path printing in install-and-config.
- Cross-cutting runtime behavior is covered by integration tests.
