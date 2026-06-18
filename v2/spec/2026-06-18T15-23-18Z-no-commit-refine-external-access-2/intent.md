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

The intent targets a plan-mode "refine" phase that no longer exists; its acceptance signals and doc updates are unsatisfiable as written. Need operator decision on re-scope before drafting.

Evidence (current code):
- The standalone plan refine phase is retired. `shared/prompts/registry.test.ts` asserts `plan.prompt.refine` (and `intent-draft`, `intent-split`) are unavailable; intent authoring/refinement moved to `jarvis1 intent`.
- `v1/docs/plan-mode.md:7` states plan mode "starts at the **draft** phase"; there is no refine phase and no `## Refinement` / `## Refine skip` markers anywhere in the runtime path. (`v1/docs/AGENTS.md` still mentions `prompts/plan/refine.md`, but that file does not exist — stale doc, not contract.)

Unsatisfiable acceptance signals as written:
- "regression test covers `commit: false` refine success" — no refine phase to invoke.
- "test proves external `intent.md` contains the refine outcome" — refine writes no outcome; the only agent write to external `intent.md` today is an appended `## Blocker` during the draft phase.
- "Existing `commit: true` refine tests still pass" — no refine tests exist.

The underlying problem is real and current, but in the draft phase, not refine: for `commit: false`, `plan.ts` sets the agent cwd to `project.root` (`plan.ts:758`) while the spec (including `intent.md`) lives under `~/.jarvis/specs/...` (`plan.ts:804`). `runDraftPhase` runs the agent with `cwd: agentCwd` and no `additionalReadDirs` (`draft.ts:159-161`), so the external spec dir is outside the agent's write boundary (claude `acceptEdits` / codex `workspace-write`). The review and verdict-actuator phases have the same gap. Patch mode already solves this with `specOutsideWorktreeReadDirs` + per-adapter `--add-dir` (`v1/src/modes/patch/run.ts:1547`), which is the natural fix vector.

Decision needed — pick one:
1. Re-scope to the draft phase (recommended): "For `commit: false`, the draft phase runs with read/write access to the external spec dir; it can write `index.md`/subspecs and append `## Blocker` to the external `intent.md`." Acceptance becomes a `commit: false` draft regression test proving the external spec is written under the agent access boundary, plus the same fix threaded to review + actuator if in scope. Confirm whether review/actuator are in scope or a separate spec.
2. Keep "refine" literally, meaning restore a retired phase — this conflicts with the intent's own out-of-scope ("Reworking v2 `jarvis intent` or ready-intent flow") and is a much larger change; confirm explicitly if intended.

If option 1, also confirm the doc updates should target the draft phase (not "refine") in `v1/docs/plan-mode.md` and `v2/docs/v1-behaviors.md`.
