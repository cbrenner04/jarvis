# v1 plan-mode small tests

## Problem

`modes/plan/git-porcelain.sandbox-unrunnable.test.ts` and
`modes/plan/boundary.sandbox-unrunnable.test.ts` spawn real git/gh for plan-mode
plumbing.

## Task checklist

- [x] Convert bulk to mocked subprocess tests.
- [x] Drop `.sandbox-unrunnable` suffix from converted files.

## Acceptance criteria

- [x] Mockable cases use boundary; no real git/gh.
- [x] Remaining real-subprocess tests justified inline.

## Documentation updates

- None.
