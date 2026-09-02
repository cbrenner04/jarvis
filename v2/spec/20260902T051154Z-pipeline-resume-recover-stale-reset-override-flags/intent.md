---
name: pipeline-resume-recover-stale-reset-override-flags
---

# Pipeline resume/recover expose stale-reset override flags

## Prerequisites

- A redraft-resume of a `failed` plan stage auto-clears its disposable dirty worktree before the plan write step without manual `cleanup --abandon`.
- `pipeline resume`/`recover` daemon handlers accept reset-override RPC parameters and thread each into the shared stale-reset gate flags on resume dispatch.
- Resume still refuses, naming the blocking state, when a live run holds the lane worktree, an operator `## Blocker` remains, or worktree HEAD is not a descendant of base, even when reset-override RPC parameters are supplied.

## Primary implementation surface

- cli

## Problem

- Standalone `plan`/`implement` re-runs accept `--reset-despite-dirty` and `--reset-despite-landed-criteria`; pipeline `resume`/`recover` expose neither, so operators must hand-abandon dirty pipeline worktrees when resume auto-clear or ordinary gates refuse.

## Decisions

- Add `--reset-despite-dirty` and `--reset-despite-landed-criteria` to `pipeline resume` (whole-pipeline and branch-scoped) and `pipeline recover` (branch-scoped only); rules out pipeline recovery being the only re-run path with no reset lever on the CLI.
- On resume, thread each flag into the existing daemon RPC and the same `resetStaleWorkspace` preflight standalone workflow uses; each flag skips only its own gate; rules out one flag clearing both dirty reuse and landed-criteria drift.
- On recover, thread each flag into the daemon RPC for parity only; recover does not invoke `resetStaleWorkspace` preflight in this slice — rules out inventing recover-side stale-reset behavior here.
- Do not change standalone `plan`/`implement` re-run gates or intent-stage auto-clear behavior in this slice.

## Acceptance criteria

- [ ] `pipeline.test.ts` proves `pipeline resume` accepts `--reset-despite-dirty` and `--reset-despite-landed-criteria`, forwards each to the daemon RPC, and resets a dirty stage worktree that would otherwise refuse; each flag skips only its own gate; fails against the pre-fix flagless CLI path.
- [ ] `pipeline.test.ts` proves `pipeline recover` accepts `--reset-despite-dirty` and `--reset-despite-landed-criteria` and forwards each to the daemon RPC; fails against the pre-fix flagless CLI path.
- [ ] `pipeline-execution.test.ts` proves resume dispatch with forwarded override flags reaches `resetStaleWorkspace` with the same dirty-reuse and landed-criteria outcomes as standalone `implement`/`plan` re-run preflight respectively; fails against the pre-fix flagless daemon path.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — pipeline resume/recover: `--reset-despite-dirty`/`--reset-despite-landed-criteria` force a reset on resume when auto-clear or ordinary gates refuse; recover forwards the flags for RPC parity; cross-link incomplete re-run preflight gates.
- `v2/docs/v1-behaviors.md` — record pipeline resume/recover `--reset-despite-dirty`/`--reset-despite-landed-criteria` parity with standalone workflow re-runs.
