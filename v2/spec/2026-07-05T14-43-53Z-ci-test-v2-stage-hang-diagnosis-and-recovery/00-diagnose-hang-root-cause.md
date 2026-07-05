# Diagnose `Test (v2)` hang root cause

## Problem

`Test (v2)` intermittently hangs 15-20+ min with zero step progress on
GitHub-hosted runners; not reproducible locally. Root cause unknown: a real
hang in jarvis's own v2 agent-mode test scope, or a GitHub-runner-side flake.
Prior investigation (`scripts/run-v2-tests.ts`, `.github/workflows/ci.yml`)
found no `timeout` on the `spawnSync` calls or the workflow/job/step, and no
existing "stuck run" detection in `v1/src/commands/triage.ts`'s CI-poll loop
(`waitForCiGreen`) — this subspec's job is to determine which branch applies
before subspec 01 fixes it.

## Decisions

- `test:v2` (agent mode, what the `Test (v2)` step runs) partitions
  `*.sandbox-unrunnable.test.ts` files into `test:integration:v2` only
  (`scripts/test-slice.ts`), so the known unbounded-subprocess-prone tests
  are not in the hanging step's file set — don't assume those files are the
  cause without checking.

## Task checklist

- [ ] Pull job/step timing (`gh run view --json jobs` / `gh api
      repos/{owner}/{repo}/actions/runs/{id}/jobs`) for prior occurrences
      (recent PRs with a `Test (v2)` or other scoped `Test (...)` step that
      ran 15+ min) and record exact step name(s), duration, and run IDs.
- [ ] Determine whether the hang is isolated to `Test (v2)`/`Test (v2
      integration)` or also occurs on `test:v1`/`test:shared`-scoped steps,
      using the same job/step data across a wider run sample.
- [ ] Check GitHub Actions status-page/incident history for correlation with
      the observed hang timestamps; note if inconclusive.
- [ ] If no GitHub-side correlation and the hang is isolated to a specific
      v2 agent-mode test file, identify the unbounded operation (subprocess,
      socket, timer) causing it.

## Acceptance criteria

- [ ] Root cause classified as jarvis-side or GitHub-runner-side, with
      supporting evidence (step names, run IDs, timing, and/or incident
      correlation) recorded in `v1/docs/operator-runbook.md`'s CI section.

## Documentation updates

- Record the classification and evidence in `v1/docs/operator-runbook.md`'s
  existing CI/gate section (the paragraph on `Test (v2)` hangs already
  points at this investigation).
