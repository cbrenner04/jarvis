---
name: pipeline-cli-start-list-wait-detach
---

# Pipelines: operator CLI — start, list, wait, detach

Slice 4 of [per-project pipelines](../per-project-pipelines-brief.md). Prereq:
`pipeline-durable-stage-state-and-daemon-execution` (approval surfaces land with
`pipeline-approval-stage-and-resume`).

## Problem

Daemon-owned pipeline execution is unreachable without an operator surface. Observation must not
repeat `run log`'s trap of blocking on live work.

## Decisions

- Pipeline commands reuse the `--detach` admission contract shipped in #2215: exit `0` means
  admitted, stdout is the pipeline ID, attached mode blocks to terminal. Rules out a second,
  divergent launch contract.
- Listing shows stage-level state (stage ID, status, workflow invocation ID) for a pipeline, and
  pipeline-level rows across pipelines. Rules out requiring `jarvis run list` cross-referencing to
  answer "which stage is it on".
- `wait` blocks to pipeline terminal or to the next approval boundary, and reports which. Rules out
  a wait that returns on an intermediate stage without saying why.
- Every read command returns promptly on a live pipeline. Rules out an unbounded follow as the
  default (see `run-log-blocks-on-live-runs`).

## Acceptance criteria

- [ ] `start` admits a validated pipeline and prints its ID; a rejected definition exits non-zero
      before admission.
- [ ] `--detach` returns after admission with exit `0`; attached mode returns only at pipeline
      terminal — one test each.
- [ ] `list` reports pipeline rows and per-pipeline stage rows including stage status and workflow
      invocation ID.
- [ ] `wait` returns at pipeline terminal and at an awaiting-approval boundary, naming which; both
      covered.
- [ ] Every read command returns within a bounded time against a **live** pipeline; a test drives a
      non-terminal pipeline and fails if the command follows indefinitely.

## Documentation updates

- `v2/docs/write-behavior.md` — pipeline CLI surface.
- `v2/docs/operator-runbook.md` — launching and observing a pipeline.
