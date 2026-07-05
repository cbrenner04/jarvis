# v1 patch-mode small tests

## Problem

`completion-pipeline.sandbox-unrunnable.test.ts`, `preflight.sandbox-unrunnable.test.ts`,
and `subspec.sandbox-unrunnable.test.ts` spawn real git/gh for patch-mode
plumbing mockable at the subprocess boundary.

## Decisions

- Extend boundary to production call sites under test as needed.
- Keep only tests needing genuine subprocess behavior, with inline justification.
- Parallel-hang unblock for these files is already met by `test:integration:v1`
  (per-file subprocess isolation) — this subspec targets mock conversion only.

## Task checklist

- [ ] Convert bulk of the three files to mocked subprocess tests.
- [ ] Drop `.sandbox-unrunnable` suffix from files with no real spawns.

## Acceptance criteria

- [ ] Converted files spawn no real git/gh for mockable cases.
- [ ] Any remaining real-subprocess tests carry inline justification.
- [ ] Converted files run under `test:v1` agent slice (no `.sandbox-unrunnable`
      suffix) or stay in integration slice with justification if still real-process.

## Documentation updates

- None.
