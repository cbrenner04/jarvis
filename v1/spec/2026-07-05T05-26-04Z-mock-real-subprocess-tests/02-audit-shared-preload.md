# Audit shared/preload test

## Problem

`shared/preload.sandbox-unrunnable.test.ts` asserts Bun's preload mutates
`PATH` for a **real** spawned child — the assertion may not be mockable at
the git/gh boundary.

## Decisions

- If real spawn is load-bearing, keep file + inline justification per
  `v2/docs/test-writing.md`.
- If incidental, convert through boundary and drop marker.

## Task checklist

- [ ] Audit whether real spawn is load-bearing.
- [ ] Keep justified real test or convert to mock.

## Acceptance criteria

- [ ] File either (a) remains real-process with inline justification why
      `SubprocessRunner` cannot substitute, or (b) is converted to a
      marker-free mock test and real-process assertion was verified redundant.

## Documentation updates

- None beyond in-file justification if kept real.
