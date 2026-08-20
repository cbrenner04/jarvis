---
name: pipeline-execution-test-flakes-under-ci-concurrency
---

# pipeline-execution.test.ts flakes under CI concurrency

## Problem

`v2/src/daemon/pipeline-execution.test.ts` test `resumePipeline branch scope > resume branchKey default aliases the unscoped path` red-gates CI intermittently under the concurrent `Test (v2)` runner, then passes on a bare job re-run. Observed 2026-08-20 on two unrelated PRs in one session (#2935 dismiss-pipeline-rpc, #2938 dismiss-pipeline-cli) — neither touches resume code. The file passes 96/0 in isolation locally every time. This is the same class the `heavy-daemon-agent-tests-flake-under-ci-concurrency` seed (#2900) fixed by isolating `workflow-runner.test.ts` + `daemon-resume.test.ts` into a no-co-runner lane, but `pipeline-execution.test.ts` was not included in that isolation, so it still races co-runners for shared daemon/socket/temp resources.

Each spurious red forces a manual `gh run rerun --failed` and delays every merge, and risks masking a genuine failure in the same file behind "just a flake."

## Decisions

- Extend the existing no-co-runner isolation lane (the #2900 mechanism — see `scripts/ci-test-scope.ts` / the CI test job config) to include `v2/src/daemon/pipeline-execution.test.ts`, so it runs without co-runners contending for the shared daemon/socket/temp state. Rules out per-test retries, which hide real regressions.
- If the isolation lane is keyed by a marker or list, add this file to that list rather than inventing a second isolation mechanism.
- Confirm the root cause is co-runner resource contention (shared socket path / temp dir / port), not a genuine ordering bug in the test, before isolating; if it is an ordering bug, fix the test's setup/teardown isolation instead. Rules out isolating a test that is actually racing itself.

## Acceptance criteria

- [ ] `v2/src/daemon/pipeline-execution.test.ts` runs in the no-co-runner isolation lane (or its per-test resources are made unique) so it no longer shares contended daemon/socket/temp state with co-runners, pinned by the CI test-scope configuration/test that governs the isolation lane.
- [ ] A full-suite CI run of the `Test (v2)` job passes first-try across repeated runs without this test red-gating (validated by the isolation being in place; no per-test retry added).
- [ ] `bun run typecheck` and the affected test script(s) pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — if a known-flaky-test note exists, update it; otherwise note that `pipeline-execution.test.ts` is isolated for CI concurrency alongside the #2900 files.
