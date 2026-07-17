# `cli.test.ts` hardcodes `/tmp/repo` and blocks sandboxed agents from running `test:v2`

## Problem

`v2/src/cli.test.ts` writes fixtures to hardcoded absolute paths — `/tmp/repo`, `/tmp/unregistered`,
`/tmp/repo/v2/spec/...` (63 references). Under a coding agent's sandbox, writes to `/tmp` are denied,
so the `beforeAll`/`beforeEach` hooks throw and **the entire `test:v2` run fails before reaching any
other file** — even code that is correct.

Observed 2026-07-17: cleanup attempt 6's discovery implementation was correct (`cleanup.test.ts` 5/5,
full `test:v2` green **sandbox-off**), but the agent runs its verification inside a sandbox, hit the
`/tmp/repo` write denial, and honestly appended a `## Blocker` rather than fake-tick. So a genuine
pre-existing test-hygiene bug in one file walls off every v2 implement run that must run `test:v2` to
satisfy its acceptance criteria.

It also makes the suite non-hermetic and non-parallel-safe: two runs share `/tmp/repo` and can race,
and a stale `/tmp/repo` from a prior run leaks into the next.

## Decisions

- `cli.test.ts` creates its fixture roots with `mkdtempSync` under `$TMPDIR` (or `os.tmpdir()`), one
  per test/suite, and cleans them up; rules out hardcoded `/tmp/...` paths that a sandbox denies and
  that leak across runs. The repo's other tests already use `$TMPDIR` for exactly this reason
  (see the `v2-socket-tests-need-writable-tmp` precedent).
- Registered project roots and spec paths in the fixtures derive from the per-test temp root; rules
  out any residual absolute `/tmp/...` literal.
- Behavior under test is unchanged — this is a fixture-location fix only; rules out altering the
  command semantics the tests cover.

## Notes

This blocks the cleanup anchor (`v2-reclaims-its-workspace`) specifically, but the fix is general:
any v2 implement run whose subspec requires `bun run test:v2` is exposed. Prioritize accordingly.
