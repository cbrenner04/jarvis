# v1 patch PR tests

## Problem

`pr.sandbox-unrunnable.test.ts` (~1227 lines) spawns real git/gh for patch-mode
PR plumbing.

## Decisions

- May split mocked coverage if one file is unreviewable.

## Task checklist

- [ ] Convert bulk to mocked subprocess tests.
- [ ] Drop `.sandbox-unrunnable` suffix from converted files.

## Acceptance criteria

- [x] Mockable cases use boundary; no real git/gh.
- [x] Remaining real-subprocess tests justified inline.

## Documentation updates

- None.
