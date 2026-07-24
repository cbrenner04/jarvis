# Intent finalization leaves the split in `.jarvis-intent-stage/` and fails the run

## Problem

`jarvis run workflow intent` writes split intents to `.jarvis-intent-stage/` in the worktree,
runs review, and then never promotes them to `ready-intents/`, never commits, and settles the
review run `invocation_failure` — while every role invocation it made reported `exit_kind: "ok"`.
The operator is left with a failed run, an unconsumed seed, and finished work that only `find`
in the worktree reveals.

## Evidence

2026-07-24, seed `tui-shows-a-live-window-not-fifty-rows`, single-daemon machine, two concurrent
workflows (not the 3+ load regime that produced last session's `posix_spawn` corruption):

```console
$ jarvis run list | grep tui
71d3d7ef  intent/tui-shows-a-live-window-not-fifty-rows  failed  -
02a33351  intent/tui-shows-a-live-window-not-fifty-rows  failed  unsupported_resume_context  false  stop

$ jarvis run log 02a33351…
{"seq":1,"event":{"kind":"iteration_started",…}}
{"seq":2,"event":{"kind":"loop_finished","loopOutcomeKind":"invocation_failure","resumable":true}}

$ tail ~/.jarvis/telemetry.jsonl        # both review roles succeeded
{"step_id":"review","role":"critic","agent":"cursor","exit_kind":"ok"}
{"step_id":"review","role":"actuator","agent":"cursor","exit_kind":"ok","duration_ms":31319}

$ git -C ~/.jarvis/worktrees/jarvis/intent/tui-shows-a-live-window-not-fifty-rows status -s
?? .jarvis-intent-review-verdict.md
?? .jarvis-intent-review-verdict.md.owner
?? .jarvis-intent-stage/
```

The split step's own run (`71d3d7ef`) recorded `boundary_committed` with `outcomeKind: "done"`,
`runStatus: "completed"` — yet the branch head was unchanged at `origin/main`. The staged files
were complete and carried the review actuator's revisions.

Third occurrence. Two prior ones on 2026-07-24 produced malformed intent PRs #2108 and #2111,
recovered by hand in #2109; the load explanation does not cover this run.

## Decisions

- Finalization must promote every `.jarvis-intent-stage/*.md` to `<targetDir>/ready-intents/`,
  remove the stage directory and the verdict sidecars, and commit — rules out treating the stage
  as a durable output.
- A `boundary_committed` record must not report `outcomeKind: "done"` when the committer produced
  no new commit and staged output remains on disk; report the commit gap instead — same contract
  the implement path already enforces via `completion_commit_failed`. Rules out the observed
  "completed with an unchanged branch head".
- An `invocation_failure` settled while every constituent role reported `exit_kind: "ok"` must name
  what failed after the invocations. Rules out attributing a finalization failure to the agent.
- The failure must be recoverable without hand-copying files: either resume promotes the existing
  stage, or the operator gets a named command that does. Rules out `unsupported_resume_context` /
  `nextAction: "stop"` as the terminal answer when finished work is on disk.
- Out of scope: why review roles ever settle `invocation_failure` on all-`ok` roles in other steps.

## Acceptance criteria

- [ ] An intent-workflow test whose split writes two staged intents and whose review roles all
      succeed asserts both files land in `ready-intents/`, the stage directory and verdict sidecars
      are gone, and the branch has a new commit containing them; it fails against the pre-fix code.
- [ ] A test where the committer returns no new commit while staged files remain asserts the run
      does **not** record `outcomeKind: "done"` / `runStatus: "completed"`, and names the
      uncommitted stage paths; inverting the guard fails the test.
- [ ] A test asserts a post-invocation finalization failure settles with an error naming the
      finalization step, not `invocation_failure`, when every role reported `exit_kind: "ok"`.
- [ ] The failed row from the previous criterion is recoverable: a documented command promotes the
      existing stage and completes publication without re-invoking the split or review agents.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — intent publication contract: stage is transient, `ready-intents/`
  is the durable output.
- `v2/docs/operator-runbook.md` § Recovery — how to recover an intent run that failed with a
  populated stage.

## Prerequisites

None.
