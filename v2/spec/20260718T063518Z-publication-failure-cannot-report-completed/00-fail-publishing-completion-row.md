# Fail the publishing completion row

Completion publication can abort before push/PR work while the completed shrink row lets the workflow entry roll up to `completed`.

## Decisions

- Delete the standalone `gh auth status` probe; rules out a lossy, unretried auth failure before an evidence-bearing publication operation.
- Normalize command failures at the existing publication retry boundary with the original operation, message, exit code, stdout tail, and stderr tail; rules out replacing subprocess evidence with `GitHub auth unavailable`.
- Set the completion or shrink row that emits `completion_commit_failed` to `failed`; rules out changing only the workflow entry while its failing child remains `completed`.
- Keep failed `completion_commit_failed` rows resumable through snapshot reconstruction; rules out treating failed durable status as terminal for publication recovery.
- Derive workflow entry status from the failed publishing child; rules out a special entry-row mutation that diverges from normal workflow rollup.
- Run ready finalization only after confirmed PR evidence and successful publication; rules out a green completion or ready attempt after partial publication.

## Work

- Move fallible push and GitHub publication commands through the existing retry/normalization boundary and preserve subprocess output evidence.
- Settle every `completion_commit_failed` publication path on the row that owns the completion publication, including the hidden shrink row.
- Preserve publication resume eligibility for the newly failed row status.
- Cover the implement-after-shrink workflow through foreground, list, and wait reporting without live GitHub access.
- Align the durable publication, workflow-status, recovery, architecture-inventory, and v1-parity documentation.

## Acceptance criteria

- [ ] `v2/src/execution/completion-publisher.test.ts` has a regression that fails against the baseline and proves push/PR command failure is normalized inside the publication retry boundary with its real operation, message, exit code, and labelled stdout/stderr tails; no standalone auth probe runs.
- [ ] `v2/src/execution/workflow-runner.test.ts` has a regression that fails against the baseline and drives publication after hidden shrink to retryable `completion_commit_failed`, persists the normalized failure on `loop_finished`, marks the shrink publication row `failed`, and never calls ready finalization.
- [ ] `v2/src/daemon/daemon-wait-run-completion.test.ts` has a regression that fails against the baseline and proves list plus wait report the failed shrink row and failed workflow entry while retaining `nextAction: "resume"` and the terminal publication evidence.
- [ ] Foreground `jarvis run workflow implement` and `jarvis run wait` return non-zero for the failed-publication payload, while successful completion still requires confirmed PR evidence followed by a green ready gate.
- [ ] `completion_commit_failed` remains resumable when its durable run status is `failed`; `ready_gate_failed` recovery and `ready_flip_failed` terminal behavior remain unchanged.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.
- [ ] `v2/docs/write-behavior.md`, `v2/docs/operator-runbook.md`, `v2/docs/daemon-host.md`, `v2/docs/v2-architecture.md`, and `v2/docs/v1-behaviors.md` document the retry/evidence boundary, failed publishing-row and workflow-rollup semantics, recovery evidence, and the confirmed-PR-plus-green-gate `completed` contract without retaining the deleted auth-probe ordering.
