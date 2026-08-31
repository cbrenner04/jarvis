---
name: pipeline-resume-recover-stale-reset-override-flags
---

# Pipeline resume/recover expose stale-reset override flags

## Prerequisites

- A redraft-resume of a `failed` plan stage auto-clears its disposable dirty worktree before the plan write step without manual `cleanup --abandon`.
- `pipeline resume`/`recover` daemon handlers accept reset-override RPC parameters and thread each into the shared stale-reset gate flags for any stage.
- Resume still refuses, naming the blocking state, when a live run holds the lane worktree or an operator `## Blocker` remains, even when reset-override RPC parameters are supplied.

## Primary implementation surface

- cli

## Problem

- Standalone `plan`/`implement` re-runs accept `--reset-despite-dirty` and `--reset-despite-landed-criteria`; pipeline `resume`/`recover` expose neither, so operators must hand-abandon dirty pipeline worktrees in cases auto-clear deliberately skips.

## Decisions

- Add `--reset-despite-dirty` and `--reset-despite-landed-criteria` to `pipeline resume` and `pipeline recover` (whole-pipeline and branch-scoped forms); rules out pipeline recovery being the only re-run path with no reset lever.
- Thread each flag into the existing daemon RPC and the same `resetStaleWorkspace` preflight standalone workflow uses; each flag skips only its own gate; rules out one flag clearing both dirty reuse and landed-criteria drift.
- Do not change standalone `plan`/`implement` re-run gates or intent-stage auto-clear behavior in this slice.

## Acceptance criteria

- [ ] `pipeline.test.ts` proves `pipeline resume` and `pipeline recover` accept `--reset-despite-dirty` and `--reset-despite-landed-criteria`, forward each to the daemon RPC, and reset a dirty stage worktree that would otherwise refuse; each flag skips only its own gate; fails against the pre-fix flagless CLI path.
- [ ] A daemon/pipeline integration test proves the forwarded flags reach `resetStaleWorkspace` with the same outcomes as standalone `implement`/`plan` re-run preflight for dirty reuse and landed-criteria drift respectively.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — pipeline resume/recover: `--reset-despite-dirty`/`--reset-despite-landed-criteria` force a reset for any stage when auto-clear or ordinary gates refuse; cross-link incomplete re-run preflight gates.
