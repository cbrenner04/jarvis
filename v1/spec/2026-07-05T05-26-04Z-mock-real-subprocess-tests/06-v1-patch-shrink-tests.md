# v1 patch shrink tests

## Problem

`shrink.sandbox-unrunnable.test.ts` (~1079 lines) spawns real git/gh for
patch-mode shrink, including the `ci-shrink-test-hang` flake.

## Task checklist

- [ ] Convert bulk to mocked subprocess tests.
- [ ] Drop `.sandbox-unrunnable` suffix when no real spawns remain.

## Acceptance criteria

- [ ] Mockable cases use boundary; no real git/gh.
- [ ] Remaining real-subprocess tests justified inline (e.g. genuine stall path).

## Documentation updates

- None.
