---
name: pipeline-configured-final-actions
---

# Pipelines: configured terminal action (draft PR / ready / merge)

Slice 5 of [per-project pipelines](../per-project-pipelines-brief.md). Prereq:
`pipeline-approval-stage-and-resume`.

## Problem

A pipeline that ends at a draft PR still leaves the operator finishing by hand. The posture differs
per project: a reviewed pipeline should stop at draft; an unreviewed maintenance pipeline may go
straight to merge. That choice belongs in config, validated up front.

## Decisions

- The terminal action is a validated config value: leave draft PR, flip to ready, or merge. Rules
  out inferring it from review posture.
- An impossible combination is rejected at validation time, not at the last stage — e.g. merge with
  no preceding approval stage where the project requires one. Rules out discovering the conflict
  after hours of work.
- A failed terminal action settles the pipeline `failed` with the action and underlying error named,
  leaving the PR intact. Rules out reporting pipeline success over a failed merge.
- The terminal action never bypasses the ready gate. Rules out a merge path that skips gating.

## Acceptance criteria

- [ ] Each of the three terminal actions is exercised end to end against a fake publication surface;
      one test each.
- [ ] An impossible terminal-action combination is rejected before admission, naming the conflict.
- [ ] A failed terminal action settles `failed` naming the action and error; the PR is unchanged and
      the pipeline is not reported complete — inverting the guard turns the test RED.
- [ ] A merge terminal action over a red ready gate does not merge.

## Documentation updates

- `v2/docs/install-and-config.md` — terminal action config values.
- `v2/docs/workflow-runner.md` — where the terminal action sits relative to publication and gating.
