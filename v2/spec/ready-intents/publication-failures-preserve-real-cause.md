---
name: publication-failures-preserve-real-cause
---

# Publication failures preserve their real cause

Completion publication and the ready flip retry every thrown error as a “transient
network error.” Auth, permission, not-found, invalid-input, rate-limit, and unknown
failures lose their evidence, so successful agent work can end as an undiagnosable
landing failure.

Use one evidence-aware policy for completion publish and ready flip. Preserve the
normalized command failure in retry notices, terminal logs, and operator errors so a
failed landing names the publication step that failed.

## Decisions

- Share one classifier and notice formatter across completion publication and ready flip; rules out divergent retry semantics at the two call sites.
- Normalize message, exit code, and bounded separately labeled stdout/stderr tails once for classification and reporting; rules out guessed or differently rendered causes.
- Retry only positively classified transient transport failures and fast-fail unknown, auth, permission, not-found, and invalid-input failures; rules out retrying every thrown error.
- Keep three total attempts with flat 1000 ms backoff and rethrow the original failure after exhaustion; rules out unbounded retries or replacement wrapper errors.
- Preserve non-fast-forward divergence as a dedicated permanent failure; rules out treating rejected pushes as transport failures.
- Evaluate `already ready` and `not a draft` success guards before classification; rules out retrying an already-satisfied flip.
- Keep `ReadyGateError` outside publication retry classification; rules out routing test failures through transport retry.

## Documentation updates

- `v2/docs/write-behavior.md` — shared retry and diagnostic contract.
- `v2/docs/workflow-runner.md` — publication errors retained on failed landing outcomes.
- `v2/docs/operator-runbook.md` — inspect the run error instead of generic daemon-log advice.
- `v2/docs/v1-behaviors.md` — record the changed v2 retry and error behavior.

## Prerequisites

- Ready-gate and ready-flip failures are distinct in terminal logs and `run list`.
