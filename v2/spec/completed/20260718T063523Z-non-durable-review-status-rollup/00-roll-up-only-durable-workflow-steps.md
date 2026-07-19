# Roll up only durable workflow steps

Daemon `wait` and `list` currently treat an ordinary review step's intentional
absence of a run row as interruption, so a successfully reviewed plan reports
`runStatus: killed`. Persist the runner's durability classification in the
workflow snapshot and use it for the read-time status rollup.

Depends on the context in [intent.md](./intent.md). Out of scope: making generic
review durable or repairing reviewed-plan landing.

## Decisions

- Snapshot each authored step's durability from the runner's row-persistence policy; rules out rollup behavior-name skip lists that drift from execution.
- Keep write and human steps durable, reviewed-intent review durable, and ordinary review/review-debate steps non-durable; rules out creating generic review rows or dropping reviewed-intent landing resume.
- Ignore a missing row only when the snapshot explicitly marks that step non-durable; rules out treating interrupted durable work as successful.
- Treat absent durability metadata as durable; rules out migrating or silently reclassifying pre-change snapshots.
- Preserve first-authored non-`completed` durable-row propagation; rules out entry-row or last-row precedence.

## Task checklist

- Add step durability to the persisted workflow snapshot and derive it from the same runner policy that decides whether a step owns a run row.
- Make workflow status rollup walk durable snapshot steps only, with legacy snapshots defaulting every step to durable.
- Add focused snapshot and rollup regressions for reviewed plans, missing durable rows, existing non-completed rows, and legacy metadata.
- Align workflow-runner, operator-runbook, and v1-parity documentation.

## Acceptance criteria

- [x] A finished reviewed-plan workflow whose durable rows completed reports `runStatus: completed` through daemon `wait` and `list`, despite its ordinary review step having no run row.
- [x] A finished workflow with an authored durable step but no matching row reports `runStatus: killed`.
- [x] Durable step rows propagate the first authored status other than `completed`.
- [x] A workflow snapshot without durability metadata treats every authored step as durable and preserves the legacy missing-row `killed` result.
- [x] `v2/src/daemon/workflow-run-status-rollup.test.ts` adds the non-durable reviewed-plan and legacy-snapshot cases that fail against the pre-fix rollup and pass after the change.
- [x] `v2/src/execution/workflow-runner.test.ts` verifies snapshots classify ordinary plan review as non-durable while preserving durable reviewed-intent review.
- [x] `bun run typecheck` and the v2 unit and integration test suites pass.

## Documentation updates

- Update `v2/docs/workflow-runner.md` with shared step durability classification, snapshot compatibility, and missing-row rollup semantics.
- Edit `v2/docs/operator-runbook.md` Known gotchas to remove only the false-`killed` diagnosis and retain the reviewed-plan landing warning.
- Align the v2 workflow status entry in `v2/docs/v1-behaviors.md` with durability-aware `wait`/`list` rollup.
