# Scoped v2 test runner picks up `.tsx` tests

`scripts/run-v2-tests.ts`'s `walkV2TestFiles` globs only `*.test.ts`, so every
`*.test.tsx` file — including `v2/src/tui/tui-field-collector.test.tsx`'s
existing `loadInkUi()` smoke test for the Yoga TDZ regression — is silently
excluded from `test:v2`/`test:integration:v2`. CI's PR-scoped job (`ci.yml`,
triggered when `git diff` shows only `v2/**` changes) runs `test:v2`, so a
PR that touches TUI ink code never exercises the Yoga smoke test; only an
unscoped `bun run test` (full suite, e.g. on push to `main`) does. This is
the gap between "the fix exists" and "CI hermetically guards it on Linux/Bun
for the PRs that touch it."

## Decisions

- Fix `walkV2TestFiles`'s glob to include `.test.tsx` alongside `.test.ts` — rules out adding a second parallel walker or a new CI job, since the existing scoped runner is the one blind spot.
- No new test file — the regression assertion already exists (`tui-field-collector.test.tsx`'s `loadInkUi` smoke test, added in #973/`a2bef546` "TUI ink renderer isolation" alongside the Yoga-TDZ fix itself); this subspec makes the existing scoped CI path actually run it.
- `test:integration:v2` (`scripts/run-v2-tests.ts`) filters the same `walkV2TestFiles()` output by sandbox-suffix, so the glob fix covers both `test:v2` and `test:integration:v2` for free — no separate line item needed.
- CI already runs `test:v2`/`test:integration:v2` on `ubuntu-latest` via `oven-sh/setup-bun@v2` (`.github/workflows/ci.yml`), so the Linux/Bun requirement is satisfied by existing CI wiring, not new work.

## Acceptance criteria

- [x] `walkV2TestFiles()` includes `v2/src/tui/tui-field-collector.test.tsx`, `tui-log-follow-entry.test.tsx`, and `tui-entry.test.tsx` in its result.
- [x] `bun run test:v2` runs the `loadInkUi` smoke test in `tui-field-collector.test.tsx` (verify via `bun run test:v2 2>&1 | grep -c "smoke: loadInkUi"` showing 1, or equivalent).
- [x] `tui-log-follow-entry.test.tsx` and `tui-entry.test.tsx` pass under `bun run test:v2` after the glob widening (no pre-existing failures surfaced).
- [x] `scripts/ci-test-scope.test.ts`'s `"v2-only change runs test:v2 + test:integration:v2"` case stays green, confirming a `v2/**`-only diff still selects both scripts unchanged.

## Documentation updates

- `v2/docs/write-behavior.md` Verification — add a line citing `bun run test:v2` (or the specific `bun test v2/src/tui/tui-field-collector.test.tsx` smoke test) as the Linux/Bun Yoga-TDZ regression guard now included in the scoped CI job.
