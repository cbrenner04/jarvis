# Narrow operator-runbook flaky gotchas

## Problem

`operator-runbook.md` lists flaky real-subprocess gotchas (`ci-shrink-test-hang`,
`triage-merge-classify-load-flake`, `v2-test-runner-unbounded-spawn`) that should
be moot after subspecs 03–19.

## Task checklist

- [ ] Review each gotcha against converted suites.
- [ ] Drop gotchas whose failure mode no longer exists.
- [ ] Narrow any still partially applicable to remaining justified real tests.

## Acceptance criteria

- [x] `ci-shrink-test-hang` dropped or narrowed per shrink conversion (subspec 06).
- [x] `triage-merge-classify-load-flake` dropped or narrowed per CLI/command
      conversions.
- [x] `v2-test-runner-unbounded-spawn` dropped or narrowed per v2 conversion
      (subspec 19).

## Documentation updates

- [ ] `v1/docs/operator-runbook.md` — apply drop/narrow per above.
