# Document external implement execution boundary

Operator docs still end external-plan implement admission at stale-reset and defer agent-loop routing to this intent, so the split external-spec/code-worktree contract is not yet durable.

## Decisions

- Document the execution boundary in `v2/docs/workflow-runner.md` (routing lifecycle) and `v2/docs/write-behavior.md` (prompt access, criteria/index writes, review/shrink read-only behavior, Git exclusion); rules out duplicating the full admission contract from `admit-external-implement-specs`.
- Execution subspecs `00`–`04` depend on merged `admit-external-implement-specs` admission behavior (absolute external index identity, `externalPlanSpec`, preflight without materializing finished work).
- Record v2 parity with v1 external-spec in-place routing in `v2/docs/v1-behaviors.md`; name observable adapter-access differences: admitted `specReadRoot` only (no v1 project sibling dirs per `01`); deferred `cursor`/`opencode` read-dir parity per `01`.
- `verdict-patch.md` beside an absolute external `specPath` already satisfies the POSIX placement contract on main; document, do not re-implement unless resume surfaces a relative `specPath` failure.
- Cross-link from `workflow-runner.md` external-plan admission to this execution section instead of restating admission predicates; rules out operator doc churn in `operator-runbook.md` unless a worked example is required.
- Deferred to first consumer: light-review external context and explicit resume IPC regression — out of scope unless production use exists.

## Tasks

- Update `v2/docs/workflow-runner.md` with the external-spec/code-worktree split, linked routing lifecycle against `specReadRoot`, index reads from `step.specPath`, and completion/index advancement on the external tree.
- Update `v2/docs/write-behavior.md` with external prompt access (`additionalReadDirs`), criteria/index/blocker write targets, review/shrink read-only context (`SPEC_TREE` label semantics), and Git exclusion.
- Add a v2 additive `v1-behaviors.md` entry for external implement in-place routing parity, v1 sibling-dir difference, and deferred `cursor`/`opencode` read-dir parity.
- Note the admission dependency and `verdict-patch.md` POSIX placement assumption in `workflow-runner.md` or `write-behavior.md`.

## Acceptance criteria

- [ ] `v2/docs/workflow-runner.md` documents the split external-spec/code-worktree execution boundary and linked routing lifecycle consistent with `00`–`04`.
- [ ] `v2/docs/write-behavior.md` documents external prompt access, criteria/index writes, review/shrink read-only behavior, and Git exclusion for external specs.
- [ ] `v2/docs/v1-behaviors.md` records v2 parity with v1 external-spec in-place routing and names remaining observable adapter-access differences (admitted `specReadRoot` only; deferred `cursor`/`opencode` read-dir parity).
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:v2` passes.
- [ ] `bun run test:integration:v2` passes.
- [ ] `bun run test:shared` passes.
- [ ] `bun run test:integration:shared` passes.

## Documentation updates

- None beyond the acceptance criteria above.
