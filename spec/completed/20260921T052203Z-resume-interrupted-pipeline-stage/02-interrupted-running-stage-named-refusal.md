# Named refusal for an interrupted pipeline with a running stage

An `interrupted` pipeline carrying an unsettled `running` stage refuses resume with bare `pipeline_not_resumable`, naming nothing the operator can act on. Replace it with a named refusal carrying derived state, the offending stage, and the clearing verb.

## Touched surfaces

- `v2/src/daemon/pipeline-execution.ts` — refusal outcome and admission check.
- `v2/src/commands/pipeline.ts` — `parsePipelineMutationOutcome` / `formatMutationRefusal`, the only refusal-rendering site (no TUI site renders resume refusal reasons).

## Decisions

- New reason `pipeline_interrupted_running_stage`, carrying `state: "interrupted"`, the running `stageId`, and (when the stage has a linked run) `runId`; the CLI renders the clearing verb `run kill --force <runId>` from them.
- "No bare refusal" applies only to this refusal; other `pipeline_not_resumable` sites are unchanged.
- Settlement stays skipped for `interrupted` pipelines and the stage rows stay byte-identical; a non-live `running` sibling left by orphan reconciliation is refused, not settled. The existing test "resume still refuses an interrupted pipeline carrying an unsettled running stage" shows derived `interrupted` takes precedence over `running`, so the refusal is reachable on main today.
- Deferred to first consumer: clearing verb for a `running` stage with no linked run — pin when a caller needs it; render state and stage only.

## Acceptance criteria

- [x] `pipeline-execution.test.ts` "resume still refuses an interrupted pipeline carrying an unsettled running stage" asserts the `pipeline_interrupted_running_stage` refusal naming state `interrupted`, the `running` stage id, and the linked run id; it fails against the pre-fix bare `pipeline_not_resumable`. Its `dispatchCalled === false` and byte-identical `stages()` assertions are unchanged.
- [x] A `commands/pipeline.test.ts` test proves `pipeline resume` renders that refusal on stderr naming the interrupted state, the stage, and `run kill --force <runId>`; it fails against the pre-fix bare reason.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/pipeline-execution.md` — document `pipeline_interrupted_running_stage` and its clearing verb beside the resume refusals.
- `v2/docs/operator-runbook.md` — in the interrupted-resume text, name the refusal and `run kill --force <runId>`.
- `v2/docs/v1-behaviors.md` — extend the `[v2 behavior change]` entry: an `interrupted` pipeline with a `running` stage refuses with the named reason. v1 had no pipelines.
