# v1 patch-mode small tests

## Problem

`completion-pipeline.sandbox-unrunnable.test.ts`, `preflight.sandbox-unrunnable.test.ts`,
and `subspec.sandbox-unrunnable.test.ts` spawn real git/gh for patch-mode
plumbing mockable at the subprocess boundary.

## Decisions

- Extend boundary to production call sites under test as needed.
- Keep only tests needing genuine subprocess behavior, with inline justification.

## Task checklist

- [ ] Convert bulk of the three files to mocked subprocess tests.
- [ ] Drop `.sandbox-unrunnable` suffix from files with no real spawns.

## Acceptance criteria

- [ ] Converted files spawn no real git/gh for mockable cases.
- [ ] Any remaining real-subprocess tests carry inline justification.
- [ ] `bun test v1/test/modes/patch/subspec.sandbox-unrunnable.test.ts` (or its
      renamed successor) no longer hangs under `bun test --parallel` with the
      full v1 suite.

## Documentation updates

- None.
