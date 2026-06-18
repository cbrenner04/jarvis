---
name: no-commit-plan-external-spec-write-access
---

# No-commit plan phases can write the external spec dir

## Problem

Under `modes.plan.commit: false`, the spec tree (`intent.md`, `index.md`,
subspecs) lives under `~/.jarvis/specs/...`, but the plan agent runs with
`cwd = project.root`. The draft, review, and verdict-actuator phases invoke the
agent without granting access to that external spec dir, so it sits outside the
agent write boundary (claude `acceptEdits`, codex `workspace-write`). The agent
can fail to write `index.md`/subspecs or to append `## Blocker` to the external
`intent.md`.

## Desired behavior

Under `commit: false`, the draft, review, and verdict-actuator phases run with
read/write access to the external spec dir, so the agent can write
`index.md`/subspecs and append `## Blocker` to the external `intent.md`.
`commit: true` plan behavior is unchanged.

## Decisions

- Reuse the patch-mode fix vector: `additionalReadDirs` threaded to `agent.run`,
  rendered as per-adapter `--add-dir`. Don't invent a new mechanism. Rules out a
  bespoke plan-only sandbox path.
- Keep `cwd = project.root`; widen the write boundary via `--add-dir`. Rules out
  relocating the agent into `~/.jarvis/specs/...`.
- Preserve external spec storage for no-commit specs. Rules out silent fallback
  to in-repo specs.
- Wire all three phases (draft, review, verdict-actuator) in this change. Rules
  out a draft-only fix that leaves review/actuator unable to write the tree.

## Acceptance signals

- `commit: false` draft against an external spec path writes the external spec
  dir under the agent access boundary, proven by a regression test that also
  covers the `## Blocker` append path to the external `intent.md`.
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

## Prerequisites

- Patch mode grants agents `--add-dir` read/write access to a spec dir outside the agent working directory via an `additionalReadDirs` option on `agent.run`.
