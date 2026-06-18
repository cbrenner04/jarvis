# Thread additionalReadDirs to no-commit plan phases

## Problem

Under `modes.plan.commit: false`, the orchestrator `v1/src/commands/plan.ts`
writes the spec tree (`intent.md`, `index.md`, subspecs) to an external dir
under `~/.jarvis/specs/...` (already computed as `finalSpecPath`), but runs the
agent with `cwd = project.root` (`worktreePath`). The draft, review, and
verdict-actuator phases invoke `agent.run` with only `{ cwd }` — no
`additionalReadDirs` — so the external spec dir is outside the agent write
boundary (claude `acceptEdits`, codex `workspace-write`). The agent can fail to
write `index.md`/subspecs or to append `## Blocker` to the external
`intent.md`.

The three `agent.run` sites missing the external dir:

- `v1/src/modes/plan/draft.ts` `runDraftPhase` — `agent.run(prompt, { cwd:
  agentCwd })`. `agentCwd` already exists and defaults to `worktreePath`;
  `commands/plan.ts` does not pass it, so cwd is `project.root`.
- `v1/src/modes/review/run.ts` — shared review runner's single
  `agent.run(prompt, { cwd: opts.cwd })`, reached via `runPlanReviewPhase`.
- `v1/src/modes/plan/verdict-actuator.ts` `runVerdictActuator` —
  `agent.run(prompt, { cwd: opts.worktreePath })`. Reached *through*
  `runPlanReviewPhase` (its actuator), not invoked directly from the
  orchestrator.

`commit: true` plan keeps spec files inside the worktree (`cwd`), so it needs
no widening.

## Decisions

- Reuse the patch-mode fix vector: `additionalReadDirs` threaded to `agent.run`,
  rendered per-adapter as `--add-dir`. Don't invent a plan-only sandbox path.
- Orchestrator (`v1/src/commands/plan.ts`) forwards the already-computed
  `finalSpecPath` as `additionalReadDirs = [finalSpecPath]` only when
  `commit === false`; leave it unset for `commit: true` so committed plan
  behavior is byte-for-byte unchanged. Rules out widening the boundary for
  committed runs that don't need it.
- Add an optional `additionalReadDirs` to the shared review runner
  (`RunReviewOptions`) consumed at its one `agent.run` site. Patch review leaves
  it unset. Rules out a plan-only fork of the shared runner.
- Pass the external spec dir itself (`finalSpecPath`, the dir holding
  `intent.md`/`index.md`), matching the per-adapter `--add-dir <dir>` grant.
  Rules out passing the parent `~/.jarvis/specs/<project>` root and
  over-granting.

## Tasks

- In `v1/src/commands/plan.ts`, forward `additionalReadDirs = [finalSpecPath]`
  to `runDraftPhase` and `runPlanReviewPhase` only when `commit === false`
  (`finalSpecPath` is already in scope; do not re-derive it).
- Thread `additionalReadDirs` from `runDraftPhase` (`draft.ts`) to its
  `agent.run` call.
- Thread `additionalReadDirs` from `runPlanReviewPhase` (`review.ts`) into the
  shared review runner and into the actuator's `runVerdictActuator`; consume it
  at each `agent.run`.
- Add an optional `additionalReadDirs` field to `RunReviewOptions` and apply it
  at the shared runner's `agent.run` site (`run.ts`).
- Add a regression test for the no-commit draft path that drives the production
  call path — i.e. does **not** pass the spec dir as the agent's working
  directory — and asserts the captured `agent.run` options carry the external
  spec dir in `additionalReadDirs`, including on the `## Blocker` append path to
  the external `intent.md`.

## Acceptance criteria

- [ ] Under `commit: false`, a plan draft against an external spec path captures
      `agent.run` options whose `additionalReadDirs` contains the external spec
      dir (`finalSpecPath`), proven by a regression test that drives the
      production call path (it does not pass the spec dir as the agent's working
      directory).
- [ ] The same no-commit draft regression test asserts `additionalReadDirs`
      contains the external spec dir on the `## Blocker` append path (the only
      honest signal with a fake agent: the dir reached `agent.run`, not that a
      write grant enabled the append).
- [ ] Under `commit: false`, the review phase passes the external spec dir to
      the shared review runner's `agent.run` via `additionalReadDirs`.
- [ ] Under `commit: false`, the verdict-actuator phase invokes `agent.run`
      with the external spec dir in `additionalReadDirs`.
- [ ] Under `commit: true`, plan draft, review, and verdict-actuator each invoke
      `agent.run` with no plan-spec directory in `additionalReadDirs` (committed
      behavior unchanged); existing `commit: true` plan tests pass.
- [ ] Patch review leaves the shared review runner's `additionalReadDirs`
      option unset (the shared runner is not widened for patch callers).
- [ ] `bun run typecheck` passes.
- [ ] `bun test` passes.

## Documentation updates

- `v1/docs/plan-mode.md`: under `commit: false`, the draft, review, and
  verdict-actuator phases run with `--add-dir` write access to the external
  spec dir so the agent can write `index.md`/subspecs and append `## Blocker`
  to the external `intent.md`.
- `v2/docs/v1-behaviors.md`: record the changed v1 plan-mode behavior —
  no-commit plan phases grant the agent `--add-dir` access to the external
  spec dir. Note the grant is write-effective only for claude (`acceptEdits`)
  and codex (`workspace-write`); cursor/opencode accept and ignore the
  directory (so a non-default `modes.plan.agentOrder` on those agents still
  can't write the external tree).

## Out of scope

- Changing default `modes.plan.commit`.
- Reworking v2 `jarvis intent` or the ready-intent flow.
- Granting the external dir on `commit: true` runs.
- The resume path: it hard-codes `commit: true` (`commands/plan.ts`), so a
  no-commit run never reaches it and the `commit === false` gate at the
  orchestrator call sites already excludes it. Rules out missing that resume
  also drives the review phase.
- Making cursor/opencode honor `--add-dir` writes — an inherited limitation of
  the patch-mode `additionalReadDirs` prerequisite, not introduced here.
- Sandbox policy changes outside plan phases.
