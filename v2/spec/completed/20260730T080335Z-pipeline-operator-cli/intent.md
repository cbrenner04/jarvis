---
name: pipeline-operator-cli
---

# Start, list, and wait for pipelines

## Prerequisites

- Project configuration resolves and validates its selected pipeline definition before durable admission effects.
- Daemon pipeline admission durably creates rows and returns the pipeline ID.
- Admitted pipeline execution remains daemon-owned after client disconnect.
- The state store enumerates admitted pipelines with complete ordered stage records.
- Daemon pipeline snapshots report current pipeline and ordered stage state promptly.
- Daemon pipeline waits identify terminal versus awaiting-approval boundaries.

## Problem

Operators cannot launch or observe daemon-owned pipelines from the CLI.

## Decisions

- Expose `jarvis pipeline start <project> (--seed <path> | --seed-text <text>) [--detach]`, `jarvis pipeline list`, and `jarvis pipeline wait <pipeline-id>` as one command family; rules out cross-referencing `jarvis run list` to infer pipeline progress.
- Start resolves and validates the configured pipeline before daemon connection or admission; rules out rejecting a definition after durable rows or workflow effects exist.
- Detached start prints only the admitted pipeline ID and exits `0`; rules out a second launch contract where detach implies completion.
- Attached start prints the same pipeline ID and remains blocked across `awaiting-approval`; it returns only after the pipeline reaches a terminal state, including after a later explicit approval decision; rules out returning on admission or an approval boundary.
- List prints pipeline rows and per-pipeline ordered stage rows with stage ID, status, and workflow invocation ID; rules out hiding stage progress behind run-list lookup.
- List is a bounded snapshot on live pipelines, while wait is the explicit blocker; rules out observation commands following live work by default.
- Wait returns at pipeline terminal or the next awaiting-approval boundary and names which occurred; rules out an ambiguous intermediate success.

## Acceptance criteria

- [ ] `v2/src/commands/pipeline.test.ts` fails on baseline and then shows valid `pipeline start` printing its admitted ID, while invalid project pipeline configuration exits non-zero before daemon connection or durable effects.
- [ ] The attach/detach regression in `v2/src/commands/pipeline.test.ts` fails on baseline and then proves `--detach` exits `0` after admission while attached start remains blocked until terminal.
- [ ] The list/wait regression in `v2/src/commands/pipeline.test.ts` fails on baseline and then reports ordered stage ID, status, and workflow invocation ID plus distinct terminal and awaiting-approval boundaries.
- [ ] The live-list regression in `v2/src/commands/pipeline.test.ts` fails on baseline and returns within its bound while a pipeline remains non-terminal.
- [ ] Inverting each pre-admission, detach, list non-follow, and wait-boundary guard makes `v2/src/commands/pipeline.test.ts` fail.
- [ ] The help regression in `v2/src/commands/pipeline.test.ts` fails on baseline and then exposes the `jarvis pipeline` family, start operands, detach behavior, list snapshot, and wait boundaries.

## Documentation updates

- `v2/docs/write-behavior.md` — pipeline command syntax, output, exit codes, attach/detach semantics, list snapshot, and wait boundaries.
- `v2/docs/operator-runbook.md` — launch, detach, list, and wait workflows for operators.
