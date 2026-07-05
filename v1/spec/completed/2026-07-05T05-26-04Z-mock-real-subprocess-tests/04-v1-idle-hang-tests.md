# v1 idle-hang fixture tests

## Problem

`idle-hang-fixtures.sandbox-unrunnable.test.ts` covers real process spawn/reap
for hang fixtures — audit which cases need real subprocess vs mock.

## Decisions

- Tests proving genuine stall/timeout/kill/reap behavior may stay real with
  justification; argv/plumbing cases mock.

## Task checklist

- [ ] Audit and convert mockable cases.
- [ ] Drop suffix or split remaining real tests into a justified file.

## Acceptance criteria

- [x] Mockable coverage uses subprocess boundary; no real spawn for those cases.
- [x] Remaining real-process tests have inline justification.

## Documentation updates

- None.
