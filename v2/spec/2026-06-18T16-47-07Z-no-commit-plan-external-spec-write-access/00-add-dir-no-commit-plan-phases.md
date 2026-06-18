# Thread additionalReadDirs to no-commit plan phases

## Problem

Under `modes.plan.commit: false`, plan writes the spec tree (`intent.md`,
`index.md`, subspecs) to an external dir under `~/.jarvis/specs/...`
(`plan.ts` `finalSpecPath`), but runs the agent with `cwd = project.root`
(`worktreePath`). The draft, review, and verdict-actuator phases invoke
`agent.run` with only `{ cwd }` — no `additionalReadDirs` — so the external
spec dir is outside the agent write boundary (claude `acceptEdits`, codex
`workspace-write`). The agent can fail to write `index.md`/subspecs or to
append `## Blocker` to the external `intent.md`.

Sites that invoke the agent without the external dir:

- `v1/src/modes/plan/draft.ts` — `agent.run(prompt, { cwd: agentCwd })`.
- `v1/src/modes/plan/verdict-actuator.ts` — `agent.run(prompt, { cwd })`.
- `v1/src/modes/review/run.ts` — shared review runner's single
  `agent.run(prompt, { cwd })`, reached via `runPlanReviewPhase`.

`commit: true` plan already keeps spec files inside the worktree (`cwd`), so it
needs no widening.

## Decisions

- Reuse the patch-mode fix vector: `additionalReadDirs` threaded to `agent.run`,
  rendered per-adapter as `--add-dir`. Don't invent a plan-only sandbox path.
- Producer (`plan.ts`) sets `additionalReadDirs = [externalSpecDir]` only when
  `commit === false`; leave it unset for `commit: true` so committed plan
  behavior is byte-for-byte unchanged. Rules out widening the boundary for
  committed runs that don't need it.
- Add an optional `additionalReadDirs` to the shared review runner
  (`RunReviewOptions`) consumed at its one `agent.run` site. Patch review leaves
  it unset. Rules out a plan-only fork of the shared runner.
- Pass the external spec dir itself (the dir holding `intent.md`/`index.md`),
  matching the per-adapter `--add-dir <dir>` grant. Rules out passing the
  parent `~/.jarvis/specs/<project>` root and over-granting.

## Tasks

- Compute the no-commit external spec dir in `plan.ts` and pass it as
  `additionalReadDirs` to `runDraftPhase` and `runPlanReviewPhase` only when
  `commit === false`.
- Thread `additionalReadDirs` from `runDraftPhase` to its `agent.run` call.
- Thread `additionalReadDirs` from `runPlanReviewPhase` through to the shared
  review runner and to `runVerdictActuator`; consume it at each `agent.run`.
- Add an optional `additionalReadDirs` field to `RunReviewOptions` and apply it
  at the shared runner's `agent.run` site.
- Add a regression test for the no-commit draft path proving the external spec
  dir reaches the agent under the write boundary, including the `## Blocker`
  append path to the external `intent.md`.

## Acceptance criteria

- [ ] Under `commit: false`, a plan draft against an external spec path invokes
      the agent with the external spec dir granted as a writable `--add-dir`
      directory, proven by a regression test.
- [ ] The same no-commit draft regression test covers the agent appending a
      `## Blocker` to the external `intent.md` (external-dir write boundary
      exercised on the blocker path).
- [ ] Under `commit: false`, the review phase invokes the agent with the
      external spec dir granted as a writable `--add-dir` directory.
- [ ] Under `commit: false`, the verdict-actuator phase invokes the agent with
      the external spec dir granted as a writable `--add-dir` directory.
- [ ] Under `commit: true`, plan draft, review, and verdict-actuator invoke the
      agent without any plan-spec `--add-dir` directory (committed behavior
      unchanged); existing `commit: true` plan tests pass.
- [ ] `bun run typecheck` passes.
- [ ] `bun test` passes.

## Documentation updates

- `v1/docs/plan-mode.md`: under `commit: false`, the draft, review, and
  verdict-actuator phases run with `--add-dir` write access to the external
  spec dir so the agent can write `index.md`/subspecs and append `## Blocker`
  to the external `intent.md`.
- `v2/docs/v1-behaviors.md`: record the changed v1 plan-mode behavior —
  no-commit plan phases grant the agent `--add-dir` access to the external
  spec dir.

## Out of scope

- Changing default `modes.plan.commit`.
- Reworking v2 `jarvis intent` or the ready-intent flow.
- Granting the external dir on `commit: true` runs or on the resume path.
- Sandbox policy changes outside plan phases.
