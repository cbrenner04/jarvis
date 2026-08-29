---
name: intent-resume-uses-run-config-path
---

# Intent-finalization resume reuses stamped fix/ready from write sibling

## Prerequisites

## Problem

`inertResumeWriteLoopInput` resolves `fixCommand` and `readyCommand` via `readProjectFixCommand`/`readProjectReadyCommand` with the default `MACHINE_CONFIG_PATH`, not the owning run's actual config path — so intent-finalization resume on a non-default config uses wrong commands even when the write step was stamped correctly.

## Behavior

`inertResumeWriteLoopInput` resolves fix and ready commands from the durable write sibling run's stamped `queuedInput`, not by re-reading project commands from the default `MACHINE_CONFIG_PATH`.

## Decisions

- Copy `fixCommand`/`readyCommand` from the durable write sibling run's `queuedInput` when reconstructing intent-finalization resume input — rules out re-reading `MACHINE_CONFIG_PATH` in the helper and rules out threading a new `configPath` through `IntentFinalizationResumeContext` (`Run`, `WorkflowSnapshot`, and that context carry no `configPath` today; reachable on main when write admission stamps `queuedInput`, which the resume test must drive through a non-default machine config).
- Scope to fix/ready command resolution only — rules out re-stamping iteration bounds or review timeouts on this resume stub (out of scope for the inert resume input).

## Acceptance criteria

- [ ] Intent-finalization resume uses the write sibling row's stamped fix/ready commands instead of default-path project lookup — pinned by a test in `workflow-runner-resume.test.ts` that admits a write step under a non-default machine config then fails resume against the current default-path re-read; Mutation checkpoint: that test body carries an in-test `// @mutate` directive that restores default-path lookup and turns the scoped test red.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

None — internal resume path; operator-facing config semantics are covered by the pipeline-dispatch intent docs.
