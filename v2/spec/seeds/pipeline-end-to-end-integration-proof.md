---
name: pipeline-end-to-end-integration-proof
---

# Pipelines: one end-to-end integration proof

Slice 6 of [per-project pipelines](../per-project-pipelines-brief.md). Prereq: slices 1–5.

## Problem

Unit coverage per slice can pass while the composition is broken — the same class as "green gate is
not evidence code runs". One integration test must drive a real multi-stage pipeline through the
daemon.

## Decisions

- The proof is a single `test:integration:v2` case driving definition → daemon dispatch → stage
  progression → approval → terminal action, with agent invocation faked at the boundary. Rules out
  a suite of shallow integration cases.
- It asserts durable state at each boundary, not just the final outcome. Rules out an end-state-only
  assertion that would pass over skipped stages.
- It exercises one failure path (a failing stage) and one resume, proving resume re-enters at the
  failed stage. Rules out a happy-path-only proof.

## Acceptance criteria

- [ ] One integration test drives a multi-stage pipeline through the daemon to its configured
      terminal action and asserts durable stage rows at each boundary.
- [ ] The same test file covers a stage failure and a resume that re-enters at the failed stage
      without re-dispatching completed stages.
- [ ] `bun run test:integration:v2` exits zero.
- [ ] Skipping any stage in the harness turns the test RED.

## Documentation updates

- `v2/docs/first-workflow-walkthrough.md` — a pipeline walkthrough section.
- `v2/docs/operator-runbook.md` — pipelines are usable; link the walkthrough.
