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

- Expose start, list, and wait as one pipeline command family; rules out cross-referencing `jarvis run list` to infer pipeline progress.
- Deferred to first consumer: pipeline command nesting and start operand spelling — pin when CLI parsing needs them.
- Start resolves and validates the configured pipeline before daemon connection or admission; rules out rejecting a definition after durable rows or workflow effects exist.
- Detached start prints only the admitted pipeline ID and exits `0`; rules out a second launch contract where detach implies completion.
- Attached start prints the same pipeline ID and blocks through approval boundaries until pipeline terminal; rules out returning on admission or an intermediate stage.
- List prints pipeline rows and per-pipeline ordered stage rows with stage ID, status, and workflow invocation ID; rules out hiding stage progress behind run-list lookup.
- List is a bounded snapshot on live pipelines, while wait is the explicit blocker; rules out observation commands following live work by default.
- Wait returns at pipeline terminal or the next awaiting-approval boundary and names which occurred; rules out an ambiguous intermediate success.

## Acceptance criteria

- [ ] Valid start prints the admitted pipeline ID, while invalid project pipeline configuration exits non-zero before daemon connection or durable effects.
- [ ] Detached start exits `0` after admission without waiting; attached start remains blocked until pipeline terminal.
- [ ] List reports pipeline rows and ordered stage rows including stage ID, status, and workflow invocation ID.
- [ ] Wait reports terminal and awaiting-approval boundaries distinctly.
- [ ] A live-pipeline regression proves list returns within a bounded time instead of following execution.
- [ ] CLI help exposes the pipeline command family and its detach, list, and wait behavior.

## Documentation updates

- `v2/docs/write-behavior.md` — pipeline command syntax, output, exit codes, attach/detach semantics, list snapshot, and wait boundaries.
- `v2/docs/operator-runbook.md` — launch, detach, list, and wait workflows for operators.
