# No-commit plan phases can't write the external spec dir

**Scope.** v1 harness work — `v1/src/modes/plan/draft.ts`,
`v1/src/modes/plan/review.ts`, `v1/src/modes/plan/verdict-actuator.ts`,
`v1/src/commands/plan.ts`, docs. Lives in `v2/spec/wip-intents/` for routing.

## Problem

For `commit: false`, the spec tree (including `intent.md`, `index.md`, and
subspecs) lives under `~/.jarvis/specs/...` (`plan.ts:804`), but the plan agent
runs with `cwd` set to `project.root` (`plan.ts:758`). `runDraftPhase` invokes
the agent with `cwd: agentCwd` and no `additionalReadDirs` (`draft.ts:160`), so
the external spec dir is outside the agent's write boundary (claude
`acceptEdits` / codex `workspace-write`). The agent can fail to write
`index.md`/subspecs or to append `## Blocker` to the external `intent.md`. The
review and verdict-actuator phases have the same gap.

This supersedes the retired `no-commit-refine-external-access` ready-intent,
which targeted a plan-mode "refine" phase that no longer exists (intent
authoring/refinement moved to `jarvis1 intent`; plan starts at draft).

## Desired behavior

For `commit: false`, the draft phase — and the review and verdict-actuator
phases — run with read/write access to the external spec dir. The agent can
write `index.md`/subspecs and append `## Blocker` to the external `intent.md`.
Committed (`commit: true`) plan behavior is unchanged.

## Decisions

- Reuse the patch-mode fix vector: `specOutsideWorktreeReadDirs` +
  per-adapter `--add-dir` (`v1/src/modes/patch/run.ts:1547`). Thread
  `additionalReadDirs` from `plan.ts` through `runDraftPhase` (and review /
  actuator) to `agent.run`. Don't invent a new mechanism.
- Keep `cwd = project.root` for no-commit; widen the write boundary via
  `--add-dir`, don't relocate the agent into `~/.jarvis/specs/...`.
- Preserve external spec storage for no-commit specs; rule out silent fallback
  to in-repo specs.

## Acceptance signals

- A regression test covers `commit: false` draft success against an external
  spec path and proves the external spec dir is written under the agent access
  boundary (incl. a `## Blocker` append path to external `intent.md`).
- Review and verdict-actuator carry the same `additionalReadDirs` wiring.
- Existing `commit: true` plan tests still pass.
- `bun run typecheck` and `bun test` pass.

## Documentation updates

- `v1/docs/plan-mode.md`: no-commit plan phases run with `--add-dir` access to
  the external spec dir.
- `v2/docs/v1-behaviors.md`: the changed v1 plan-mode behavior.

## Out of scope

- Changing default `modes.plan.commit`.
- Reworking v2 `jarvis intent` or ready-intent flow.
- Broad sandbox policy changes outside plan phases.
