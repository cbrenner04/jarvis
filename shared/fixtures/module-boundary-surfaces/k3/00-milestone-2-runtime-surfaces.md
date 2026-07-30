# Milestone 2 milestone-2-runtime-surfaces

Expose published plan paths through the runtime.

## Decisions

- Keep published plan paths consistent across runtime surfaces.
- SQLite storage owns the published plan path record.
- Daemon RPC carries plan path requests.
- The CLI surfaces the published plan path to callers.

## Acceptance criteria

- [ ] SQLite storage retains the published plan path.
- [ ] Daemon RPC rejects a malformed plan request.
- [ ] The CLI prints the published plan path.

## Documentation updates

- None.
- Document SQLite plan path storage.
- Document daemon plan-path RPC handling.
- Document CLI plan path output.
