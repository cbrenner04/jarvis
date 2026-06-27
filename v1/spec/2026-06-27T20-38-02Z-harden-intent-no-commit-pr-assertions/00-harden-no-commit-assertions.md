# Harden No-Commit Assertions

## Problem

`intent` no-commit auto-ready coverage rejects bare `PR` in stderr. Stderr can include random filesystem paths, so an incidental `PR` in a temp path can fail the test without forbidden PR behavior.

## Decisions

- Match no-commit-forbidden phrases (`intent: split commit pushed`, `intent: draft PR`, `https://example.com/pull/`, `warning: could not mark PR ready for review`); rules out bare substring matching across random paths.
- Keep random temp paths; rules out deterministic paths that hide isolation bugs.
- Audit the full no-commit assertion block, including `warning` and `https://example.com`; rules out fixing only the observed `PR` flake while leaving analogous incidental-output collisions.

## Tasks

- Narrow the no-commit auto-ready stderr PR negative assertion to concrete forbidden output.
- Confirm `warning` is safe as written or narrow it.
- Confirm `https://example.com` is safe as written or narrow it.
- Run the targeted intent command test file.

## Acceptance criteria

- [ ] `v1/test/intent-command.sandbox-unrunnable.test.ts` no-commit auto-ready coverage still fails on `intent: split commit pushed`, `intent: draft PR`, `https://example.com/pull/`, or `warning: could not mark PR ready for review`, not incidental `PR` in filesystem paths.
- [ ] The `warning` negative assertion is either confirmed safe as written or narrowed.
- [ ] The `https://example.com` negative assertion is either confirmed safe as written or narrowed.
- [ ] `bun test v1/test/intent-command.sandbox-unrunnable.test.ts` passes.

## Documentation updates

None. Test-only assertion hardening; no operator-facing behavior changes.
