# 01 - Add a default per-test timeout backstop for bun test

## Problem

`bun test` in this repository has no default per-test timeout. When any
single test hangs (see subspec 00 for one observed instance), the entire
suite wedges indefinitely. The hang propagates upward:

- `bun test` never exits.
- `bun run test` never exits.
- `bun run ready` never exits.
- The agent that invoked `bun run ready` never gets a response.
- The Jarvis iteration watchdog should fire but does not (see subspec 03).

Even after subspec 00 fixes the specific bug and subspec 03 fixes the
watchdog, a future regression in the test suite would still wedge `bun
test` for as long as that runs. A per-test timeout means any such
regression surfaces as a normal test failure within bounded time.

## Scope and decisions

- Set a default per-test timeout of **30 s** via Bun's test configuration
  (`bunfig.toml`'s `[test]` block, or whichever config file this repo
  already uses for bun settings; create `bunfig.toml` if none exists).
- 30 s comfortably exceeds every current test's observed wall-clock
  duration (the slowest real-git test in this repo measured ~356 ms in
  the diagnostic run). It still terminates a true hang within half a
  minute.
- Tests that are *legitimately* slow (none currently known) may opt out
  by passing `{ timeout: <ms> }` to `test(name, opts, fn)`. The
  implementer must inventory the existing suite during impl and add
  per-test overrides only where a single test genuinely needs more time;
  no blanket increases.
- This subspec is a backstop, not a substitute for fixing the underlying
  bug (subspec 00) or fixing the watchdog (subspec 03).

## Task checklist

- Confirm or add `bunfig.toml` with a `[test]` section setting
  `timeout = 30000`.
- Run the full suite under the new default and inventory any tests that
  exceed 30 s. For each, decide explicitly: increase the default, opt
  that test out, or rewrite the test to be faster.
- Update `docs/development.md` (or wherever `bun test` is documented) to
  describe the default timeout and the per-test override pattern.

## Acceptance criteria

- [x] `bun test` enforces a 30 s default per-test timeout.
- [x] The full suite passes under the new default with no test exceeding
  the timeout (or with explicit, justified per-test opt-outs documented
  inline).
- [x] A test that intentionally sleeps for 31 s fails with a timeout
  message (verified manually during impl; this test does not need to land
  in the repo).
- [x] Documentation describes the default timeout and the per-test
  override pattern.
- [x] `bun run typecheck` passes.
- [x] `bun test` passes.
- [x] `bun run check` passes.

## Implementation notes

The 30s timeout is enforced via `bun test --timeout=30000` in the package.json
test script. Although bunfig.toml was created with `[test] timeout = 30000` as
specified, Bun v1.3.13 does not currently read test timeout configuration from
bunfig.toml; the command-line flag in the npm script is the effective mechanism.

## Documentation updates

- Add a short subsection to `docs/development.md` (or the README's
  Development section) covering the default per-test timeout and how to
  override it per-test.
