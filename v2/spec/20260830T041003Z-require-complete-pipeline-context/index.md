# Require complete persisted pipeline context

- [ ] [00 - Pipeline context loader](./00-pipeline-context-loader.md)
- [ ] [01 - Pipeline admission context gate](./01-pipeline-admission-context-gate.md)
- [ ] [02 - Malformed persisted context fails stage](./02-malformed-persisted-context-failure.md)

Scope: fail-closed validation for persisted `PipelineContext` — required `configPath` (and `cwd`) at admission and on every durable reload; one shared loader for fresh execution and continuation; legacy incomplete rows fail the pending stage before dispatch. Depends on landed shared workflow-start preparation requiring an explicit machine-config path (`workflow-start-preparation.ts`).
