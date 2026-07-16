---
name: publication-retries-classify-and-report-errors
---

# Publication retries classify and report errors

Completion publication and ready finalization currently retry every thrown error while
asserting that it is a transient network failure. Permanent GitHub failures waste attempts,
and retry notices omit the error that triggered them.

## Behavior

- Completion push/PR/body publication and `gh pr ready` retry only classified transient failures.
- Auth, permission, not-found, invalid-input, and other permanent failures stop after one attempt.
- Each retry notice includes the operation, attempt, and concrete error message, exit code, and stdout/stderr tail available from the failed command.
- Non-fast-forward push rejection and the ready flip's `already ready` / `not a draft` success guards retain their distinct behavior.

## Decisions

- Apply one retry policy to `completion-publisher` and `ready-finalize` — rules out fixing only one publication path.
- Classify from captured command evidence before retrying — rules out treating every thrown error as transient.
- Preserve command failure evidence in retry notices — rules out replacing the cause with a generic network label.

## Out of scope

- Run-log persistence of the terminal publication cause.
- Workflow process exit codes.
- Review-step log emission.

## Documentation updates

- `v2/docs/write-behavior.md` — publication classification, retry notices, and fast-fail behavior.
- `v2/docs/v1-behaviors.md` — align the v2 publication-retry parity record.

## Prerequisites
