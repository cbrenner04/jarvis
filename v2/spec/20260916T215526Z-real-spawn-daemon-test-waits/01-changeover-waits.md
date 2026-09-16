# Changeover waits

`v2/src/daemon/daemon-changeover.sandbox-unrunnable.test.ts` (~10.1s) boots an incumbent per test and uses fixed sleeps (50–250ms) plus a 5.5s probe window.

## Decisions

- The 5.5s probe in "the default fallback does not roll back a successor still inside its startup budget" stays longer than the old 5s deadline — shortening it below 5s voids the regression.
- Replace fixed sleeps preceding positive assertions with `waitFor`; keep fixed sleeps only for negative windows.
- Share an incumbent only across tests that neither retire it, change its handoff state, nor pass custom `startIncumbent` options; no blanket `beforeAll`. Most tests here pass distinct `fallbackMs`/handler options, so sharing may end up applying to few or no tests — that's an acceptable outcome, not a target to force.
- If any tests do end up sharing an incumbent, each sharing test must also pass run alone (`bun test -t "<title>"`), to rule out order dependence from shared run history or sampling state.
- Timing method: `bun test v2/src/daemon/daemon-changeover.sandbox-unrunnable.test.ts` on the same machine, merge base vs after — not the aggregate gate's time.

## Acceptance criteria

- [ ] `bun test v2/src/daemon/daemon-changeover.sandbox-unrunnable.test.ts` runs faster than the same command at the merge base, with identical test titles and test count unchanged or higher.
- [ ] Any test sharing a boot with another test in this file also passes when run alone via `bun test -t "<title>"`.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass; this file itself runs under `test:integration:v2` (the `.sandbox-unrunnable.test.ts` suffix routes it there, not `test:v2`) — run with the sandbox disabled (writable `/tmp`, Unix sockets).

## Documentation updates

- None here; `v2/docs/test-writing.md` is updated in the final subspec.
