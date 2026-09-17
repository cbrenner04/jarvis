# Self-handoff waits

`v2/src/daemon/daemon-self-handoff.sandbox-unrunnable.test.ts` (~6.7s) uses 150–200ms fixed sleeps and a harness per test.

## Decisions

- Replace fixed sleeps preceding positive assertions with `waitFor`; negative windows stay fixed but no longer than the interval they cover.
- Share a harness only across tests that leave it unsuperseded; superseding/retiring tests keep a fresh one. Every test in this file currently starts its own named harness, so sharing may end up applying to few or no tests — that's an acceptable outcome, not a target to force.
- If any tests do end up sharing a harness, each sharing test must also pass run alone (`bun test -t "<title>"`), to rule out order dependence from shared run history or sampling state.
- Timing method: `bun test v2/src/daemon/daemon-self-handoff.sandbox-unrunnable.test.ts` on the same machine, merge base vs after — not the aggregate gate's time.

## Acceptance criteria

- [x] `bun test v2/src/daemon/daemon-self-handoff.sandbox-unrunnable.test.ts` runs faster than the same command at the merge base, with identical test titles and test count unchanged or higher.
- [x] Any test sharing a boot with another test in this file also passes when run alone via `bun test -t "<title>"`.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass; this file itself runs under `test:integration:v2` (the `.sandbox-unrunnable.test.ts` suffix routes it there, not `test:v2`) — run with the sandbox disabled (writable `/tmp`, Unix sockets).

## Documentation updates

- None here; `v2/docs/test-writing.md` is updated in the final subspec.
