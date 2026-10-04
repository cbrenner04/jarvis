- Define `ready-gate-failed` as a stable non-zero exit code, terminal telemetry outcome, and run-summary reason; it must never emit terminal `criteria-complete`.

- Define the completion population: state whether `git: false`, zero-iteration/rerun, and human-only-only completion paths are gated or excluded.

- Define “shared gate” as the same full verification primitive used by `triage --merge`; retain triage-only CI-backed flake recovery. A red verification result—not operational gate failures—maps to `ready-gate-failed`.

- Specify compatibility for existing `readyGateRetryBound` configs while removing it from supported behavior; avoid either silently changing valid saved configs or leaving ambiguous validation behavior.

- Require that a red result performs no completion fix-up agent invocation, reset/force-push/discard recovery, ready promotion, or success exit.

- Anchor green-path preservation to existing completion, shrink, review, and ready-promotion tests; also anchor preservation of `triage --merge` flake recovery. This protects the intent’s shared-gate correction without weakening merge behavior.

These refinements make the terminal contract observable, preserve distinct operational failures, and meet the required durable documentation update for changed v1 behavior.
