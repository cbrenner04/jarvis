# Classify completion publication failures

Retry push, PR ensure, and PR-body refresh only for evidenced transient transport failures, with the triggering command evidence in each notice.

## Decisions

- Retry only positively classified transient transport failures; rules out retrying unknown, auth, permission, not-found, invalid-input, and other permanent failures.
- Normalize thrown command evidence once for classification and notices; rules out message-only classification that drops exit code or captured output.
- Emit bounded, separately labeled stdout and stderr tails when present; rules out unbounded output or merging streams into ambiguous evidence.
- Keep three total attempts with flat 1000 ms backoff; rules out changing publication cadence while tightening eligibility.
- Preserve the dedicated non-fast-forward divergence error before generic permanent propagation; rules out losing its operator diagnosis in the classifier.
- Leave terminal-cause run-log persistence and workflow exit codes unchanged; rules out absorbing adjacent publication-failure intents.

## Tasks

- Add one evidence-aware publication retry policy and route completion push, PR lookup/create, and body refresh through it.
- Preserve command error message, exit code, stdout, and stderr from production and injected failures.
- Add focused classification, retry-notice, and preservation coverage.

## Acceptance criteria

- [ ] `v2/src/execution/completion-publisher.test.ts` gains regression cases that fail against the baseline and prove auth, permission, not-found, invalid-input, and unrecognized failures stop after one attempt without delay or retry notice.
- [ ] Evidenced transient push, PR lookup/create, and PR-body refresh failures retry up to three total attempts with 1000 ms backoff; exhausted retries rethrow the original failure.
- [ ] Every completion retry notice identifies the operation and next attempt and includes the triggering message, exit code, and available bounded stdout/stderr tails.
- [ ] Non-fast-forward push rejection still stops after one attempt with the dedicated divergence error.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md`: replace blanket publication retries with evidence-based classification, fast-fail categories, and retry-notice evidence.
- `v2/docs/v1-behaviors.md`: align the v2 completion-publication parity record and source citations.
