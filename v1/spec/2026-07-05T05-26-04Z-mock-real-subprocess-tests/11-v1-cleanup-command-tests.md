# v1 cleanup-command tests

## Problem

`cleanup-command.sandbox-unrunnable.test.ts` (~1303 lines) spawns real git/gh.

## Task checklist

- [ ] Convert bulk to mocked subprocess tests.
- [ ] Drop `.sandbox-unrunnable` suffix when no real spawns remain.

## Acceptance criteria

- [ ] Mockable cases use boundary; no real git/gh.
- [ ] Remaining real-subprocess tests justified inline.

## Documentation updates

- None.
