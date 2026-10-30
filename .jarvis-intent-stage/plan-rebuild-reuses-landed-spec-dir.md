---
name: plan-rebuild-reuses-landed-spec-dir
---

# Plan rebuild reuses an existing landed spec directory

## Problem

`buildPlanWorkflowSteps` mints a fresh `<UTC>-<name>` directory on every build, so `pipeline resume` after a failed plan stage lands another tree beside the first on the same `plan/<name>` branch.

## Decisions

- Git-enabled repo-spec plan only; external `plans/<name>/` paths are unchanged.
- When the managed `plan/<name>` worktree or branch already contains a landed `<targetDir>/*-<name>/` tree, reuse the newest matching basename for `specPath`, `durablePath`, and draft prompts; mint a timestamp only when none exists.
- Plan chooses lookup mechanics (branch tip vs materialized worktree) in one place here rather than at landing.

## Prerequisites

## Primary implementation surface

- `src/execution/publication-workflow-steps.ts`

## Documentation updates

- `docs/workflow-runner.md` — a retried plan rebuild reuses the branch's existing timestamped spec directory when one is already landed.
