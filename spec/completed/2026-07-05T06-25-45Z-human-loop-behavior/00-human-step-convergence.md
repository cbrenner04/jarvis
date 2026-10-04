# 00 - Human step convergence

Add `human` as a second workflow step `behavior`. Reaching a human step converges
the run to a new terminal-like status, `awaiting-human`, without invoking the
write loop and without writing a blocker to the spec. Decision-gated resume
(approve/abort/revise) lands in later subspecs; this subspec only establishes
the convergence point and guards `resume` against it.

## Decisions

- Add `"awaiting-human"` to `RUN_STATUSES` — distinct from `blocked`, since human
  steps need decision-gated resume, unlike blocked's no-resume-path.
- `WorkflowStepInput` becomes a discriminated union on `behavior`: the existing
  write-step shape (`behavior: "write"`) plus a new human-step shape
  (`behavior: "human"`, `stepId`) — a human step carries none of the
  write-loop-only fields (`role`, `agents`, `stepRules`, `agentModelConfig`,
  `expectedArtifactPath`) it never uses, and no `worktree` of its own: the
  worktree that matters for a human gate is whichever step `onRevise` names
  (subspec 02), not the gate itself.
- `executeWorkflow` dispatches a human step to a path that creates/loads its run
  row and sets status `awaiting-human` directly via the state store, without
  calling `executeWriteLoop`/`executeWrite` — human steps carry no attempt/outcome
  history.
- Reaching a human step appends no `## Blocker` section to the spec — that helper
  is contract-miss-specific spec content, not a human-review signal.
- `resume` RPC rejects `awaiting-human` runs with the same terminal-run error
  class as `completed`/`failed`/`blocked`, until decision-gated resume lands —
  rules out reconstructing a bogus `WriteLoopInput` for a step that never ran one.
- `list`'s per-step workflow snapshot reports a stopped human step's
  `terminalOutcome` as `"awaiting-human"` — rules out misclassifying it as
  `blocked` or `invocation_failure`.

## Acceptance criteria

- [x] A workflow whose active step has `behavior: "human"` converges via
      `executeWorkflow` to a run with status `awaiting-human`, returning
      `WorkflowResult.kind === "awaiting-human"`, without invoking
      `executeWriteLoop`.
- [x] Reaching a human step appends no `## Blocker` section to the step's spec file.
- [x] Daemon `resume` RPC rejects a run whose status is `awaiting-human` with a
      `terminal_run`-class error, matching its existing `completed`/`failed`/`blocked`
      rejections.
- [x] Daemon `list` reports a stopped human step's `terminalOutcome` as
      `"awaiting-human"`.
- [x] `defineWorkflowStep` accepts an input with `behavior: "human"` and returns
      the corresponding `WorkflowStep` shape.

## Documentation updates

- `v2/docs/workflow-runner.md`: document the `human` behavior, its dispatch path,
  and convergence semantics (no write loop, no blocker file).
- `v2/docs/daemon-host.md`: add `awaiting-human` to the `resume` rejection list
  and to the `terminalOutcome` vocabulary for workflow snapshot rows.
