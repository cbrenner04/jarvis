---
name: ci-test-v2-stage-hangs
---
# CI `Test (v2)` stage hangs intermittently on GitHub-hosted runners

## Problem

The `Test (v2)` step within CI's `checks` job intermittently hangs with zero
step progress for 15-20+ minutes, on runs where every other run of the same
step (same repo, same test scope) completes in under a minute. Observed 6
times across 4 PRs (#1045, #1047 twice, #1048 twice, #1049) in one session.
Not reproducible locally; not correlated with local machine load (GitHub
Actions runners are remote). `gh run cancel <id>` + `gh run rerun <id>
--failed` reliably recovers on the next attempt.

## Decisions

- Root cause not yet diagnosed (GitHub-side runner flake vs. a real hang in
  the v2 test scope under specific timing). Needs investigation before a
  fix can be scoped: check whether it's isolated to `test:v2`/`test:integration:v2`
  or hits `test:v1`/`test:shared` too, whether it's a specific test file or
  general, and whether GitHub Actions status page shows correlated incidents.
- If root-caused to jarvis's own test scope (e.g. an unbounded spawn or
  socket wait), fix there. If it's GitHub-runner-side, the harness fix is
  operator-facing automation: detect a stuck `Test (v2)` step (zero log
  growth past some threshold) and auto cancel+rerun instead of requiring
  manual `gh run cancel`/`gh run rerun` each time.

## Task checklist

- [ ] Investigate whether this is isolated to `Test (v2)`/`Test (v2 integration)`
      or occurs on other scoped test steps too.
- [ ] Check GitHub Actions runner-side correlation (incident history, runner
      pool exhaustion) vs. a real hang in jarvis's own v2 test suite.
- [ ] If root-caused to jarvis: fix the underlying hang.
- [ ] If GitHub-runner-side: consider automating the cancel+rerun recovery
      (e.g. `jarvis1 triage --merge`'s CI-poll loop detects a stuck job by
      elapsed time on an unchanging step and cancels+reruns automatically).

## Acceptance criteria

- [ ] Root cause identified and documented, or the automated recovery lands.
- [ ] No behavior change to specs/PRs unaffected by this stall pattern.

## Documentation updates

- Update `v1/docs/operator-runbook.md`'s CI/gate section once a fix or
  automated recovery lands.
