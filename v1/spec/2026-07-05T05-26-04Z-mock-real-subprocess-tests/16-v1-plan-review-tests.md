# v1 plan review tests

## Problem

`modes/plan/review.sandbox-unrunnable.test.ts` (~1018 lines) spawns real git/gh
for plan-mode review plumbing.

## Task checklist

- [ ] Convert bulk to mocked subprocess tests.
- [ ] Drop `.sandbox-unrunnable` suffix when no real spawns remain.

## Acceptance criteria

- [x] Mockable cases use boundary; no real git/gh.
- [x] Remaining real-subprocess tests justified inline.

## Documentation updates

- None.
