# Differently keyed daemons coexist

Keying the endpoint (subspec 00) is only useful if two daemons with different digests actually run at once over real sockets and neither observes the other's runs. Nothing pins that end to end.

## Decisions

- Exercise real Unix sockets and real daemon processes rather than a stubbed connector; rules out passing on path arithmetic while the processes collide on PID file or log.
- Name the file `*.sandbox-unrunnable.test.ts`; real-socket tests need a writable temp dir and are excluded from sandboxed runs by the existing convention.
- Drive both daemons through the CLI entrypoint with two stub executable digests; rules out calling `startDaemon` with hand-built paths, which passes against the pre-change code.
- Assert `run list` and `run wait` isolation by starting a run on one daemon only; rules out an emptiness-only assertion that passes when neither daemon has rows.

## Tasks

- Add a two-daemon coexistence test that starts each via the CLI under a distinct stub digest and an isolated `JARVIS_HOME`.
- Assert socket, PID, and process-log paths are disjoint and both daemons report healthy at once.
- Assert `run list` and `run wait` from each CLI report only that daemon's rows.

## Acceptance criteria

- [ ] Two daemons started under different executable digests are simultaneously live, with disjoint socket, PID, and process-log paths and no lifecycle error from the second start.
- [ ] With a run present on only one daemon, `run list` from the other returns no rows for it, and `run wait` from the other does not resolve against it.
- [ ] The coexistence test fails against the pre-change fixed-socket code (the second start collides on the shared socket and PID) and passes after subspec 00.
- [ ] `bun run typecheck` and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — concurrently running daemons keyed by different digests do not share socket, PID, or log paths, and observation is scoped to the selected daemon.
