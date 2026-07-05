# v1 plan-command tests

## Problem

`plan-command.sandbox-unrunnable.test.ts` (~1356 lines) spawns real git/gh for
plan command plumbing.

## Decisions

- May split mocked coverage if one file is unreviewable.

## Task checklist

- [ ] Convert bulk to mocked subprocess tests.
- [ ] Split if needed; drop `.sandbox-unrunnable` from converted files.

## Acceptance criteria

- [ ] Mockable cases use boundary; no real git/gh.
- [ ] Remaining real-subprocess tests justified inline.

## Documentation updates

- None.
