# v1 plan commits tests

## Problem

`modes/plan/commits.sandbox-unrunnable.test.ts` (~462 lines) spawns real git/gh
for plan-mode commit-shaping logic.

## Task checklist

- [ ] Convert bulk to mocked subprocess tests.
- [ ] Drop `.sandbox-unrunnable` suffix when no real spawns remain.

## Acceptance criteria

- [ ] Mockable cases use boundary; no real git/gh.
- [ ] Remaining real-subprocess tests justified inline.

## Documentation updates

- None.
