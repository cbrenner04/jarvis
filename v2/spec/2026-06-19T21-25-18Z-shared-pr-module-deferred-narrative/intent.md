---
name: shared-pr-module-deferred-narrative
---
# Shared PR module with template narrative and deferred body updates

**Scope.** Merge `modes/patch/pr.ts`, `modes/plan/pr.ts`, both `pr-description-prompt.ts`; completion-pipeline PR body timing.

## Problem

PR logic and description prompts are duplicated across patch and plan. PR narrative agent runs on every subspec complete after the first, with up to 40k chars of spec context. `updatePrBody` / `gh pr edit` fire per subspec instead of once at completion.

## Desired behavior

Single shared PR module serves patch and plan. Default PR narrative is a deterministic template (index H1, subspec titles, commit subjects). Config `modes.patch.prNarrative` / `modes.plan.prNarrative`: `template` | `agent` (default `template`). `updatePrBody` / `gh pr edit` defer to completion pipeline (once before shrink/review); first subspec still calls `ensureDraftPr`.

## Decisions

- Default narrative mode is `template`, not agent. Rules out agent-authored PR body on every run unless configured.
- PR body refresh happens once in completion pipeline before shrink/review, not per subspec complete. Rules out `gh pr edit` on every index checkbox tick after the first.
- First subspec completion still ensures draft PR exists. Rules out deferring initial PR creation to terminal subspec.
- Shared module replaces patch/plan PR duplicates; config keys remain mode-scoped. Rules out a third parallel PR implementation per mode.

## Acceptance signals

- Tests prove template narrative produces expected PR body from index + commits without agent call when config is `template`.
- Tests prove `agent` config still invokes narrative agent.
- Tests prove PR body update runs once at completion transition, not on intermediate subspec completes.
- `bun run typecheck` and `bun run test` pass.

## Documentation updates

- `v1/docs/worktrees-and-commits.md`: PR narrative modes and deferred body update timing.
- `v2/docs/v1-behaviors.md`: shared PR module and narrative defaults.

## Out of scope

- PR attribution footer mechanics (unchanged).
- Tiered ready pipeline.
- Shrinking PR context for agent narrative when `agent` mode is selected beyond existing caps.

## Prerequisites
