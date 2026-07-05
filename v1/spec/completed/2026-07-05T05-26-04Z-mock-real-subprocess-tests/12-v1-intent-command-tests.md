# v1 intent-command tests

## Problem

`intent-command.sandbox-unrunnable.test.ts` (~2057 lines, largest suite) spawns
real git/gh for the intent seed/draft/split pipeline.

## Decisions

- Split mocked coverage into multiple files if one file is unreviewable.

## Task checklist

- [x] Convert bulk to mocked subprocess tests.
- [x] Split if needed; drop `.sandbox-unrunnable` from converted files.

## Acceptance criteria

- [x] Mockable cases use boundary; no real git/gh.
- [x] Remaining real-subprocess tests justified inline.

## Documentation updates

- None.
