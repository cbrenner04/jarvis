# Milestone 2 milestone-2-runtime-surfaces

Expose published plan paths through the runtime.

## Decisions

- Keep unrelated milestone scope on the first emitted child.
- Retain published plan paths in SQLite storage.
- Reject malformed plan requests at the daemon RPC layer.
- Expose published plan paths through CLI commands.
- Milestone 2 milestone-2-runtime-surfaces supersedes the draft.
- Split from milestone-2-runtime-surfaces planning.

## Acceptance criteria

- [ ] SQLite storage retains the published plan path.
- [ ] Daemon RPC rejects a malformed plan request.
- [ ] The CLI prints the published plan path.

## Documentation updates

- Document SQLite retention behavior in persistence docs.
- Document daemon RPC validation in operator runbook.
- Document CLI plan-path output in install-and-config.
- None.
