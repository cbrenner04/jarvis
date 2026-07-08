# 00 - Run shrink after implement complete

An `implement` write step that reaches `complete` runs one hidden shrink write-loop pass before the workflow reports completion or advances to the next step.

## Decisions

- Trigger shrink from the workflow runner's post-`complete` boundary, not by adding `shrink` to the `implement` preset — rules out daemon/TUI rendering shrink as an authored preset step.
- Run shrink only after an `implement` write step returns `complete`, not after `budget-exhausted`, `paused`, `blocked`, `contract_miss`, or `invocation_failure` — rules out cleanup on resumable or failed boundaries.
- Run exactly one shrink write-loop invocation with `role: "shrink"` and `promptId: "patch.prompt.shrink"` using the completed step's worktree/spec/artifact context — rules out a parallel shrink executor and rules out reusing the implement prompt.
- Use a separate shrink binding chain and telemetry `role: "shrink"` while keeping the authored workflow snapshot unchanged — rules out attributing shrink invocations to `implement` or adding a visible shrink step row.
- Treat a non-`complete` shrink outcome as the workflow's stopping outcome for the current step — rules out best-effort discard before later workflow steps.

## Tasks

- Add the post-implement-complete shrink hook through the existing workflow/write-loop path.
- Resolve shrink bindings via the same `(agent, role) -> rungs` machinery used by write steps.
- Preserve the one-step `implement` preset and daemon/TUI workflow snapshot shape.
- Cover trigger, non-trigger, attribution, and failure-routing behavior with v2 tests.
- Update durable docs for workflow runner, write behavior, role resolution, and agent-model-config shrink wiring.

## Acceptance criteria

- [ ] `executeWorkflow` invokes one shrink write-loop pass after an `implement` write step returns `complete`, before returning workflow `complete`.
- [ ] `executeWorkflow` does not invoke shrink after `budget-exhausted`, `paused`, `blocked`, `contract_miss`, or `invocation_failure` from the implement step.
- [ ] The shrink pass uses the completed implement step's worktree, spec path, artifact path, step rules, agent order, and model config, but resolves bindings for `role: "shrink"` and renders `promptId: "patch.prompt.shrink"`.
- [ ] Shrink invocation telemetry records `role: "shrink"` on a distinct binding chain from the implement invocation.
- [ ] A non-`complete` shrink outcome stops the workflow at the implement step and reports that shrink outcome without running later workflow steps.
- [ ] The `implement` workflow preset remains one authored step and daemon/TUI workflow snapshots do not include a separate shrink step row.
- [ ] `bun test v2/src/execution/workflow-runner.test.ts v2/src/execution/implement-workflow-steps.test.ts v2/src/execution/write-loop.test.ts` passes.
- [ ] `v2/docs/workflow-runner.md`, `v2/docs/write-behavior.md`, `v2/docs/role-resolution.md`, and `v2/docs/agent-model-config.md` document runtime shrink wiring with no "caller not wired" stale language.

## Documentation updates

- `v2/docs/workflow-runner.md`: document the hidden post-implement-complete shrink hook, stop conditions, and snapshot visibility.
- `v2/docs/write-behavior.md`: document operator-facing `jarvis run workflow implement` completion behavior and verification.
- `v2/docs/role-resolution.md`: replace "runtime shrink-step invocation is not wired yet" with the implemented caller.
- `v2/docs/agent-model-config.md`: replace shrink caller footnotes with the runtime consumption contract.
