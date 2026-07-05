# v1 run tests

## Problem

`run.sandbox-unrunnable.test.ts` (~1081 lines) spawns real git/gh for the
patch run loop.

## Task checklist

- [ ] Convert bulk to mocked subprocess tests.
- [ ] Drop `.sandbox-unrunnable` suffix when no real spawns remain.

## Acceptance criteria

- [x] Mockable cases use boundary; no real git/gh.
- [x] Remaining real-subprocess tests justified inline.

## Documentation updates

- None.
