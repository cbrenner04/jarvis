# v1 plan PR tests

## Problem

`modes/plan/pr.sandbox-unrunnable.test.ts` (~1032 lines) spawns real git/gh for
plan-mode PR plumbing.

## Task checklist

- [ ] Convert bulk to mocked subprocess tests.
- [ ] Drop `.sandbox-unrunnable` suffix when no real spawns remain.

## Acceptance criteria

- [ ] Mockable cases use boundary; no real git/gh.
- [ ] Remaining real-subprocess tests justified inline.

## Documentation updates

- None.
