# v1 CLI tests

## Problem

`v1/test/cli.sandbox-unrunnable.test.ts` (~838 lines) spawns real git/gh for
CLI routing mockable at the subprocess boundary.

## Task checklist

- [ ] Convert bulk to mocked subprocess tests.
- [ ] Drop `.sandbox-unrunnable` suffix when no real spawns remain.

## Acceptance criteria

- [x] Mockable cases use boundary injection; no real git/gh.
- [x] Remaining real-subprocess tests justified inline.

## Documentation updates

- None.
