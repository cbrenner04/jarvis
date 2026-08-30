# Settle daemon failure outcomes atomically

Authoritative for daemon-owned failure settlement: acceptance criteria, documentation updates, and material decisions in this file supersede `intent.md` where they differ.

## Problem

Queued binding resolution, write-loop spawn rejection, workflow async rejection, and restart-recovery admission failure write `failed` separately from the cause or log evidence that explains it. Immediate `list` or `wait` can therefore observe an unexplained terminal row.

## Decision ledger

- Daemon-owned harness failures settle with `terminalCause: "invocation_failure"` and an available `terminalFailureDetail`; rules out treating the later `run_execution_failed` or `run_recovery` append as the durable cause.
- Binding re-resolution failures use `failureKind: "model_config"`; thrown executor, workflow, and recovery-admission failures use `failureKind: "error"`, with empty `bindingAttempts` and the bounded available message; rules out collapsing configuration refusal into a generic harness error or inventing a daemon-only evidence shape.
- Durable `terminalCause` and `terminalFailureDetail` are authoritative for a daemon-owned settlement; attempt and terminal-log composition remains the fallback for legacy rows without those fields; rules out either ignoring atomic evidence or breaking pre-migration history.
- Structured terminal events remain lifecycle history and append after durable settlement; rules out coupling terminal visibility to log availability.
- Already-settled rows keep their status and evidence when a later daemon exception is reported; rules out overwriting completion, blocked, paused, or killed recovery semantics with a secondary harness failure.
- `setRunStatus` remains for `queued` → `in-progress` and other nonterminal recovery writes; rules out routing queue promotion or resume admission itself through terminal settlement.

## Tasks

- Route queued binding-resolution refusal, background write-loop executor rejection, workflow async-path rejection, and failed restart-recovery admission through `commitTerminalRunSettlement`, supplying the classified cause and available failure detail in the same call as `failed`.
- Project durable terminal cause and failure detail through the shared `list` / `wait` result and operator-error composition paths before consulting terminal logs or attempts, while retaining legacy fallbacks.
- Keep existing best-effort log append, cleanup, ownership release, queue promotion, unsupported-recovery, and nonterminal promotion/resume behavior.
- Add focused daemon regressions for every migrated failure emitter, including immediate observation before its structured terminal event is available.
- Update the durable docs below.

## Acceptance criteria

- [ ] `v2/src/daemon/daemon-run-failure-capture.test.ts` test `executor rejection exposes atomic durable cause and evidence before its log append` holds the failure reporter, observes the settled row through both `list` and `wait`, and reports `failed`, `loopOutcomeKind: "invocation_failure"`, and the matching error message from `terminalFailureDetail`; it fails against the pre-fix split status/log path.
- [ ] `v2/src/daemon/daemon-run-failure-capture.test.ts` test `workflow async rejection exposes atomic durable cause and evidence` drives rejection after a workflow run row exists and proves its immediate `list` and `wait` result carries the same invocation-failure cause and message committed on the row; it fails against the pre-fix `setRunStatus` plus append path.
- [ ] `v2/src/daemon/daemon-queue-promotion.test.ts` test `binding-resolution refusal settles queued run with model-config evidence` proves the run stays unspawned and becomes `failed` with `terminalCause: "invocation_failure"` and matching `failureKind: "model_config"` detail in one settlement; it fails against the pre-fix status-only write.
- [ ] `v2/src/daemon/daemon-reconciliation.test.ts` test `failed restart recovery admission settles with its diagnostic` proves a non-`resume_unsupported` refusal becomes `failed` with atomic invocation-failure cause and message while successful and unsupported rows retain their existing outcomes; it fails against the pre-fix status-only recovery write.
- [ ] `v2/src/daemon/daemon-run-failure-capture.test.ts` test `a run already terminal at rejection time is not re-demoted but still records the failure` stays green, and its assertions cover preservation of prior durable settlement evidence.
- [ ] `v2/src/daemon/daemon-queue-promotion.test.ts` promotion-order, memory-watermark, binding-re-resolution, paused-release, and closed-store tests stay green (nonterminal queue behavior unchanged).
- [ ] `v2/docs/daemon-host.md` and `v2/docs/v1-behaviors.md` document daemon failure-settlement ownership, durable cause/detail classification, immediate `list` / `wait` projection, legacy fallback, log ordering, and preserved cleanup/recovery behavior.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — replace split spawn/workflow/recovery failure settlement with atomic durable cause/detail, immediate observation, log-history ordering, and unchanged cleanup and unsupported-recovery behavior.
- `v2/docs/v1-behaviors.md` — record daemon-owned failure emitters and `list` / `wait` consuming their atomic settlement evidence.
