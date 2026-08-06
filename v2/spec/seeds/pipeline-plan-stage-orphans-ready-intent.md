---
name: pipeline-plan-stage-orphans-ready-intent
---

# Configured-pipeline plan stage does not consume its ready-intent, orphaning it on main

Standalone `run workflow plan` deletes the ready-intent it planned from as part of its own PR (ready-intent in → spec tree out, ready-intent removed). The `full-review` pipeline plan stage does **not**: it branches from `main` and hands the ready-intent to plan via the durable stage artifact, but its plan PR only *adds* the spec tree. Merging the intent PR (which adds the ready-intent) and then the plan PR leaves the ready-intent file orphaned on `main` — a consumed input that nothing removed.

## Evidence

- 2026-08-05, `mutation-checkpoint-verifier-trust`: intent PR #2602 added
  `v2/spec/ready-intents/mutation-checkpoint-verifier-trust.md`; plan PR #2603 (based on
  `main`) added the spec tree but did not delete the ready-intent. Merging both as-is
  would have left the ready-intent orphaned. Hand-fix: merge `main` into the plan branch
  and `git rm` the ready-intent so the plan PR consumes it (matching standalone plan).
- Recurs structurally on every full-review pipeline run.

## Root cause

Stages hand off through durable stage artifacts recorded on each stage's entry-run worktree; the plan stage rematerializes from its resolved repository base (`main`), which at branch time has no ready-intent to delete. Standalone plan, by contrast, runs against a base that already carries the ready-intent and deletes it in-PR.

## Decisions

- The pipeline plan stage (or its landing) must consume — delete — the ready-intent it
  planned from, so its PR diff removes the file, matching standalone plan's ready-intent
  consumption. The ready-intent identity is already known to the stage (it is the plan
  input artifact / `specPath`).
- Out of scope: changing the artifact-handoff mechanism itself; the intent PR still adds
  the ready-intent (its provenance copy also lands as the spec tree's `intent.md`).

## Acceptance criteria

- [ ] After a full-review pipeline plan stage, the plan PR's diff **deletes** the consumed
      ready-intent (`v2/spec/ready-intents/<slug>.md`); a regression asserts the deletion
      is present in the plan landing's file set.
- [ ] A standalone `run workflow plan` still deletes its ready-intent exactly as today (no
      regression on the working path).
- [ ] Mutation checkpoint: a `// @mutate` directive removing the ready-intent-deletion
      step from the pipeline plan landing turns its regression RED; pin via a
      unique-basename test.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/first-workflow-walkthrough.md` § Configured pipeline — note the plan stage
  consumes its ready-intent (no orphan), correcting any implication that intermediate
  artifacts persist on main.

## Prerequisites

- The pipeline plan-stage landing/commit path (daemon stage dispatch)
- Standalone plan's ready-intent consumption logic (for parity)
- Durable stage artifact / `specPath` carrying the ready-intent identity
