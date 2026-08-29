---
name: intent-resume-uses-run-config-path
---

# Intent-finalization resume reads fix/ready from run config path

## Prerequisites

## Problem

`inertResumeWriteLoopInput` resolves `fixCommand` and `readyCommand` via `readProjectFixCommand`/`readProjectReadyCommand` with the default `MACHINE_CONFIG_PATH`, not the owning run's actual config path — so intent-finalization resume on a non-default config uses wrong commands even when the write step was stamped correctly.

## Behavior

`inertResumeWriteLoopInput` resolves fix and ready commands from the run's stored machine-config path (the same path pipeline dispatch and CLI stamping use), not the default global path.

## Decisions

- Thread the run's config path into `inertResumeWriteLoopInput` from resume context already available on the execution path — rules out re-reading `MACHINE_CONFIG_PATH` inside the helper.
- Scope to fix/ready command resolution only — rules out re-stamping iteration bounds or review timeouts on this resume stub (out of scope for the inert resume input).

## Acceptance criteria

- [ ] `inertResumeWriteLoopInput` resolves fix/ready commands from the run's config path, not the default `MACHINE_CONFIG_PATH` — pinned by a test in `workflow-runner-resume.test.ts`; fails against the current code.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

None — internal resume path; operator-facing config semantics are covered by the pipeline-dispatch intent docs.
