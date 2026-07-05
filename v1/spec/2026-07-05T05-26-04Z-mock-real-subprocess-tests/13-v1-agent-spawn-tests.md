# v1 agent-spawn tests

## Problem

`agents/spawn.sandbox-unrunnable.test.ts` (~578 lines) spawns real agent CLIs
for argv/output/exit-code handling mockable at the subprocess boundary.

## Decisions

- May split remaining justified real tests into a separate `.sandbox-unrunnable`
  file.

## Task checklist

- [ ] Convert bulk to mocked subprocess tests (canned stdout/stderr/exit-code).
- [ ] Drop suffix or split remaining real tests.

## Acceptance criteria

- [ ] Mockable cases assert argv/env and canned I/O without real agent CLI.
- [ ] Remaining real-process tests justified inline (e.g. process-group/kill).

## Documentation updates

- None.
