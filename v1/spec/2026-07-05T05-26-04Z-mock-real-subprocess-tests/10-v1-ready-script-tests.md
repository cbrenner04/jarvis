# v1 ready-script tests

## Problem

`ready-script.sandbox-unrunnable.test.ts` (~618 lines) spawns real subprocesses
for `scripts/ready.ts` behavior.

## Task checklist

- [ ] Convert bulk to mocked subprocess tests.
- [ ] Drop `.sandbox-unrunnable` suffix when no real spawns remain.

## Acceptance criteria

- [x] Mockable cases use boundary; no real git/gh/subprocess where mockable.
- [x] Remaining real-subprocess tests justified inline.

## Documentation updates

- None.
