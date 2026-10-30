---
name: plan-rebuild-reuses-landed-spec-dir
---

# Plan rebuild reuses an existing landed spec directory

## Problem

`buildPlanWorkflowSteps` mints a fresh `<UTC>-<name>` directory on every build, so `pipeline resume` after a failed plan stage lands another tree beside the first on the same `plan/<name>` branch.

## Decisions

- Git-enabled repo-spec plan only; external `plans/<name>/` paths are unchanged.
- When the managed `plan/<name>` worktree or branch already contains a landed `<targetDir>/*-<name>/` tree, reuse the newest matching basename for `specPath`, `durablePath`, and draft prompts; mint a timestamp only when none exists.
- Matching is exact: a directory basename matches only `^\d{8}T\d{6}Z-<name>$` (the `SPEC_TIMESTAMP_PREFIX` shape in `src/commands/cleanup-artifacts.ts` plus the exact ready-intent name), never a `*-<name>` suffix glob; and only trees the plan branch added relative to its base ref count — a same-named tree already on the base (e.g. an earlier plan or archived spec) is never reused or removed.
- Newest-matching selection is the shared survivor rule: plan landing duplicate cleanup (plan-landing-removes-duplicate-spec-trees) keeps that same tree when removing sibling matching directories.
- Plan chooses lookup mechanics (branch tip vs materialized worktree) in one place here rather than at landing.

## Prerequisites

## Primary implementation surface

- `src/execution/publication-workflow-steps.ts`

## Acceptance criteria

- [ ] A retried git-enabled plan rebuild on `plan/<name>` reuses the newest existing `<targetDir>/*-<name>/` on that branch for `specPath`, `durablePath`, and draft prompts instead of minting a fresh timestamp when a matching tree already exists.
- [ ] External `plans/<name>/` plan rebuild behavior is unchanged (no repo-spec reuse path).
- [ ] When no matching landed tree exists, rebuild still mints a new timestamped directory as today.
- [ ] A tree whose slug merely ends in `-<name>`, or a same-named tree already present on the base ref, is not reused (test).

## Documentation updates

- `docs/workflow-runner.md` — a retried plan rebuild reuses the branch's existing timestamped spec directory when one is already landed.
- `docs/v1-behaviors.md` — `[harness behavior change]` entry for plan rebuild reusing an existing landed spec directory on resume.
