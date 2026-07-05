# v1 patch review tests

## Problem

`review.sandbox-unrunnable.test.ts` (~1588 lines, largest patch suite) spawns
real git/gh for review-phase plumbing.

## Decisions

- May split mocked coverage into multiple files if one file is unreviewable.

## Task checklist

- [ ] Convert bulk to mocked subprocess tests.
- [ ] Split files if needed; drop `.sandbox-unrunnable` from converted files.

## Acceptance criteria

- [x] Mockable cases use boundary; no real git/gh.
- [x] Remaining real-subprocess tests justified inline.

## Documentation updates

- None.
