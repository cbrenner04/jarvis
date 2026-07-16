# 00 - Preserve publication failure evidence

Completion publication and the ready flip currently retry every thrown error as transient and discard command evidence from durable operator diagnostics.

## Decisions

- Normalize each failure once as operation, message, exit code, and separately labeled bounded stdout/stderr tails; rules out classifying or rendering different evidence at each consumer.
- Share one transport classifier, retry runner, and notice formatter between completion publication and ready flip; rules out call-site-specific retry policy.
- Retry only positive transient-transport matches; rules out retrying unknown, auth, permission, not-found, invalid-input, or rate-limit failures.
- Use three total attempts with flat 1000 ms backoff and rethrow the original error after exhaustion; rules out wrapper replacement or altered retry timing.
- Classify non-fast-forward push divergence as a dedicated permanent failure while retaining its command evidence; rules out transport retry or a generic replacement error.
- Evaluate ready flip `already ready` and `not a draft` guards before classification; rules out retrying an already-satisfied flip.
- Keep `ReadyGateError` on the gate-repair path outside publication classification; rules out treating test failures as transport failures.
- Add optional normalized failure detail to publication terminal events and operator errors, and expose it through `list`/`wait`; rules out requiring daemon-process logs to diagnose landing failures.

## Work

- Add the shared publication failure normalizer, classifier, retry policy, and formatter.
- Route push, PR ensure, body refresh, and ready flip through the shared policy without routing the ready gate through it.
- Retain the failed operation and normalized evidence in retry notices, write/workflow results, terminal logs, daemon `list`/`wait` errors, and CLI output.
- Preserve idempotent ready-flip guards and dedicated non-fast-forward handling.
- Update focused unit, write-loop, workflow, daemon-error, and CLI coverage.
- Align the durable documentation contracts.

## Acceptance criteria

- [x] `v2/src/execution/publication-retry.test.ts` fails against the baseline and proves normalization retains message and exit code, keeps bounded labeled stdout/stderr tails, positively identifies supported transport failures, and rejects unknown, auth, permission, not-found, invalid-input, and rate-limit failures.
- [x] Completion push, PR ensure, body refresh, and ready flip share the same classifier, notice format, three-attempt cap, and flat 1000 ms backoff; permanent failures make one attempt and exhausted transient failures rethrow the original error.
- [x] Retry notices name the publication operation and include its normalized failure evidence instead of the generic `transient network error` diagnosis.
- [x] Non-fast-forward push divergence fast-fails as its dedicated permanent failure with the underlying command evidence intact.
- [x] `already ready` and `not a draft` still satisfy the ready flip before classification; `ReadyGateError` still enters gate repair without publication retry.
- [x] Direct-write and workflow publication failures retain the failing publication operation and normalized evidence in their result and `loop_finished` record.
- [x] Daemon `list` and `wait`, plus `jarvis run list`/`wait`, expose the retained publication failure detail alongside `completion_commit_failed` or `ready_flip_failed`; operators need not inspect daemon-process logs.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.
- [x] `v2/docs/write-behavior.md`, `v2/docs/workflow-runner.md`, `v2/docs/daemon-host.md`, `v2/docs/operator-runbook.md`, and `v2/docs/v1-behaviors.md` document the shared retry, evidence, terminal-error, and recovery contracts in their durable homes.

## Documentation updates

- `v2/docs/write-behavior.md` — shared normalization, classification, retry, and diagnostic contract.
- `v2/docs/workflow-runner.md` — retained publication cause on failed completion outcomes.
- `v2/docs/daemon-host.md` — terminal-log and `list`/`wait` operator-error detail.
- `v2/docs/operator-runbook.md` — inspect the run error before daemon-process logs.
- `v2/docs/v1-behaviors.md` — changed v2 publication retry and evidence behavior.
