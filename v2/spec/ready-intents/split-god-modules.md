---
name: split-god-modules
---
# Split patch and plan god modules

**Scope.** `patch/run.ts` → `preflight.ts`, `iteration.ts`, `completion-pipeline.ts`, thin `run.ts`; `commands/plan.ts` → `modes/plan/run.ts` with CLI staying args-only.

## Problem

`patch/run.ts` (~2k LOC) and `commands/plan.ts` (~1.5k LOC) mix preflight, iteration, completion pipeline, and PR concerns.

## Desired behavior

Patch orchestration splits into focused modules with thin `run.ts` re-exporting the public entry. Plan phase orchestration moves to `modes/plan/run.ts`; `commands/plan.ts` handles CLI args only. Observable behavior unchanged.

## Decisions

- Refactor-only slice: no behavior changes beyond file boundaries and imports. Rules out bundling new features into the split PR.
- Split follows landed behavior seams (preflight, iteration, completion pipeline). Rules out arbitrary file cuts that scramble ownership mid-migration.
- `commands/plan.ts` stays args-only after extraction. Rules out leaving orchestration in the CLI command module.

## Acceptance signals

- `patch/run.ts` and `commands/plan.ts` shrink to thin entry/orchestration layers; logic lives in named modules.
- Existing patch/plan integration tests pass without behavior assertion changes beyond import paths.
- `bun run typecheck` and `bun run test` pass.

## Documentation updates

- `v2/docs/v1-behaviors.md`: note module layout only if operator-facing paths change (expected: no).

## Out of scope

- New patch/plan features.
- v2 engine layout.
- Changing public CLI surface.

## Prerequisites

- Harness-owned patch routing injects active subspec and slimmed prompts.
- Shared PR module serves patch and plan with deferred body updates.
- Agent invocations route quota fallback through shared invocation executor.
- Shrink phase supports tooling-first ladder and `modes.patch.shrink` off switch.
- Harness exposes tiered fast/full ready pipelines with gate reuse.
- Single shared module parses spec index, blocker, and acceptance-criteria sections.
- Plan draft structural validation runs before `plan: draft` commit.
