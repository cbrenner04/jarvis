# Gate implement admission on pipeline resolution

The existing `jarvis run workflow implement` launch builder is the production
admission seam: it runs before stale-worktree reset, daemon `start`, run-row
creation, external-worktree materialization, and agent invocation. Make it resolve
the selected pipeline after project matching and model loading, then refuse invalid
selection before any of those effects. This gates admission only; executing source
pipeline stages is deferred to the later pipeline-execution slice.

## Decisions

- The implement launch builder reads the matched project's pipeline fragment through `readProjectPipelineConfig` and invokes the resolver before returning workflow steps. It supplies the already-loaded `AgentModelConfig`; project matching still uses `readProjectRegistry`.
- Resolution failure is rendered as its named resolver error by `jarvis run workflow implement` and stops before `prepareWorkflowSteps`, stale-worktree reset, or daemon connection/start. It creates no durable run row, materializes no worktree, and invokes no agent.
- Selection success admits the existing implement workflow unchanged in this slice. The selected, validated definition is carried only as admission evidence until the dedicated pipeline-execution consumer is introduced; this subspec does not promise that unrelated later dispatch failures cannot occur.
- The admission ordering is project-config parse, source lookup, override target checks, composed-definition validation, then the existing launch/admission work. It preserves the resolver's deterministic ordering.

## Task checklist

- Wire project-pipeline resolution into the implement launch builder before all admission effects.
- Return named selection/config/definition errors through the existing workflow command path.
- Add an end-to-end command/daemon-seam regression test with spies for durable rows, worktree materialization, and agent execution.
- Document the pre-admission gate and the deferred stage-execution consumer.

## Acceptance criteria

- [ ] A `v2/src/commands/workflow.test.ts` regression drives `jarvis run workflow implement` through its existing project-config and admission-facing entry point. A valid configured selection admits the legacy implement workflow, and the assertion fails against the pre-change baseline.
- [ ] The same regression gives that project an invalid selected definition and asserts the named resolver error plus zero run-row creations, zero external-worktree materializations (including stale-reset work), and zero agent invocations; it fails against the pre-change baseline and passes after the gate is wired.
- [ ] The command preserves the resolver's parse → lookup → override-target → validation precedence, and a failure at any phase reaches the operator before daemon start or all other admission effects.
- [ ] Inverting the admission-resolution guard or any failure-effect suppression guard makes the corresponding command regression fail; zero-effect assertions cover each suppressed effect.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.
- [ ] `v2/docs/workflow-runner.md` documents validation before implement admission, the zero-effect failure boundary, and that dispatching selected pipeline stages is deferred.

## Documentation updates

- `v2/docs/workflow-runner.md` — implement admission gate, failure boundary, and deferred stage-execution consumer.
