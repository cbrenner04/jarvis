---
name: finalization-failure-is-named-not-reported-done
---

# A failed intent finalization is named, not reported `done` or blamed on the agent

## Problem

Two dishonest terminal records from the same 2026-07-24 incident:

- The split run `71d3d7ef` recorded `boundary_committed` with `outcomeKind: "done"`,
  `runStatus: "completed"` while the committer produced no new commit and the branch head was
  unchanged at `origin/main`, with `.jarvis-intent-stage/` still populated.
- The review run `02a33351` settled `loop_finished` `invocation_failure` while every role
  invocation it made reported `exit_kind: "ok"` in `telemetry.jsonl` — attributing a
  post-invocation finalization failure to the agent.

The operator sees a completed run with no output, and a failed run that names the wrong culprit.

## Decisions

- A completion boundary reports the commit gap instead of `outcomeKind: "done"` /
  `runStatus: "completed"` when the committer produced no new commit and staged output remains on
  disk, and names the uncommitted stage paths — same contract the implement path already enforces
  via `completion_commit_failed`. Rules out "completed with an unchanged branch head".
- A failure arising after all role invocations settles with an error naming the finalization step
  rather than `invocation_failure` when every role reported `exit_kind: "ok"`. Rules out
  attributing a finalization failure to the agent.
- Scope is the terminal record only; promotion/commit behavior itself is a separate change.

## Acceptance criteria

- [ ] A test where the committer returns no new commit while staged files remain asserts the run
      does **not** record `outcomeKind: "done"` / `runStatus: "completed"` and names the
      uncommitted stage paths; inverting the guard fails the test.
- [ ] A test asserts a post-invocation finalization failure settles with an error naming the
      finalization step, not `invocation_failure`, when every role reported `exit_kind: "ok"`.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — boundary settlement contract: no `done` with an unchanged head
  and a populated stage; post-invocation failures are named by step.
- `v2/docs/v1-behaviors.md` — record the changed settlement behavior.

## Prerequisites
