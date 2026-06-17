---
name: no-commit-refine-external-access
---

# No-commit refine can edit external intent

## Prerequisites

## Problem

For `commit: false`, intent draft writes `intent.md` under `~/.jarvis/specs/...`, but refine runs from the target repository cwd. Agents with workspace write boundaries can fail to read or append to the external artifact.

## Desired behavior

- For `commit: false`, intent refinement runs with read/write access to the external spec artifact.
- Refine can append `## Refinement`, `## Refine skip`, or `## Blocker` to external `intent.md`.
- Committed plan behavior is unchanged.

## Decisions

- Run no-commit refine against the external spec artifact contract; rule out target-repo-only cwd as the writable boundary.
- Preserve external spec storage for no-commit specs; rule out silent fallback to in-repo specs.
- Fix the agent cwd/access contract; rule out shell-copying intent content through the target repository.

## Acceptance signals

- A regression test covers `commit: false` refine success against an external spec path.
- The test proves the external `intent.md` contains the refine outcome after the phase.
- Existing `commit: true` refine tests still pass.
- `bun run typecheck` and `bun test` pass.

## Documentation updates

- Update `v1/docs/plan-mode.md` to state no-commit refine edits the external `intent.md`.
- Update `v2/docs/v1-behaviors.md` for the changed v1 plan-mode behavior.

## Out of scope

- Changing default `modes.plan.commit`.
- Reworking v2 `jarvis intent` or ready-intent flow.
- Broad sandbox policy changes outside plan refinement.

## Blocker

This intent targets a "refine" phase that does not exist in the live `jarvis1 plan` flow; its premise cannot be drafted as-is. Need an operator decision before spec drafting.

Findings (verified in this checkout):
- The live plan pipeline is intent-write -> draft -> review. There is no refine phase. `plan.ts` calls `runDraftPhase` directly after writing `intent.md`; no `runRefinePhase`/refine call exists (`v1/src/commands/plan.ts:857-877`).
- The refine machinery the intent names is orphaned: `runIntentDraftTurn`/`buildIntentDraftPrompt` (`v1/src/modes/plan/intent-draft.ts`) have zero callers, `commitPlanRefine` (`v1/src/modes/plan/commits.ts:75`) is invoked only by its own test, and no `prompts/plan/refine.md` or `intent-draft.md` exists. The `shared/prompts` registry test asserts `plan.prompt.refine` is absent. Refine/intent-draft moved to `jarvis1 intent` per commit `c5069a3` (#226).
- The real bug the intent describes is live, but in the **draft** phase, not refine: for `commit: false`, `intent.md` and spec files are written to the external `~/.jarvis/specs/...` dir (`plan.ts:733-811`), yet the draft agent runs with `cwd = project.root` and **no** `additionalReadDirs` granting the external dir (`runDraftPhase` -> `agent.run(prompt, { cwd: agentCwd })`, `v1/src/modes/plan/draft.ts:110,159-161`). Agents with workspace write boundaries (claude `acceptEdits`, codex `workspace-write`) cannot reach the external artifact. Patch mode already solves this via `additionalReadDirs` (`v1/src/modes/patch/run.ts:382,857-859`); claude/codex/aider honor `--add-dir`, cursor/opencode silently drop it.

Decision needed (pick one):
1. Retarget this intent to the live no-commit **draft** phase: grant the external spec dir to the draft agent via `additionalReadDirs`. Acceptance signals become draft-based, not refine-based; `## Refinement`/`## Refine skip`/`## Blocker` outcome references drop. Doc updates land on the draft-phase behavior. (Smallest fix; matches what code actually does.)
2. Revive a refine phase under `jarvis1 plan` first (new prompt, wiring, commit path), then fix its no-commit access. This is a separate, larger spec/PR that must land before this access fix is meaningful.
3. Confirm refine belongs to `jarvis1 intent` (not plan) and the access fix should target intent mode there instead — out of scope per this intent's own "Out of scope" (v2 `jarvis intent`), so this would need a new intent.

Recommendation: option 1. Reword the intent to the draft phase (problem text, desired behavior, decisions, acceptance signals, doc-update targets) and re-run plan. I will not silently reinterpret "refine" as "draft" or revive dead code without that confirmation.
