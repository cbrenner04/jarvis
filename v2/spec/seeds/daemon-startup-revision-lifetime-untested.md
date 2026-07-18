# Seed: daemon startup-revision lifetime capture has no regression guard

## Problem

`daemon-status-reports-source-snapshot` (#1753) captures the daemon's source revision once at startup
(`daemon.ts`, via the async runner, closed over by `statusHandler`) and returns it for the process
lifetime. The behavior is implemented correctly, but there is no regression test that drives the real
daemon `statusHandler` and goes RED if it recomputes HEAD live instead of returning the startup-captured
value — the daemon lacks an injectable startup-capture seam, so the shipped lifetime test operates on
the client resolver and cannot observe the daemon-side capture (see
[[agent-regression-tests-inject-the-unit-under-test]]). Mutation review confirmed the "recompute live"
mutation stays green. Also minor: the CLI `stale` → exit 1 mapping is untested (only `stopped`/`running`
exit codes are asserted).

Low risk (the code structurally captures-once via closure and has no live-recompute path), but the
carve-out is unguarded.

## Decisions

- Add an injectable startup-revision-capture seam to the daemon so a test can start it with a known
  revision and assert `status` returns that captured value even after the checkout revision changes.
- Add a CLI test asserting `stale` maps to exit 1.

## Acceptance criteria

- [ ] A regression test drives the real daemon status path and goes RED if the startup-captured
      revision is recomputed live instead of returned from the startup snapshot.
- [ ] A CLI test asserts `stale` status exits 1 (goes red if changed to 0).
- [ ] `bun run typecheck`, `test:v2`, `test:integration:v2` pass.

## Documentation updates

- None beyond test coverage.
