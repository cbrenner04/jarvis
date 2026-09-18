# 00 — derive `run-ad-hoc-terminal` from the settled marker

`invocationTerminal` (`v2/src/daemon/operator-incidents.ts`) rolls up row statuses with in-memory liveness and keys on the latest `status_changed_at`, so a non-owning daemon fires on a `completed` review row while its publication tail runs, and any row re-write re-fires. Switch it to the durable settled marker (`StateStore.readWorkflowInvocationSettledMarker`).

Evidence: on `main` after #4063, plan run `e9b69036-a276-4857-93ca-f86aee05b841` delivered two `run-ad-hoc-terminal` incidents, `terminal:completed:1789752219244` and `terminal:completed:1789752242862` — same cause, ~23 s apart, because a later-settling row minted a new timestamped transition.

## Decisions

- Incident exists iff the entry run's settled marker exists; cause and `sinceMs` come from the marker (`cause`, `settledAt`). Rules out keeping the rollup/`isLive` path as a fallback — a missing marker means no incident on any daemon.
- Transition is `terminal:${marker.cause}:${marker.settledAt}`. `settledAt` changes only when the owning daemon writes or rewrites the marker (never when further rows settle), so the e9b69036 double-delivery cannot recur, while each genuine failed republication — including fail, resume, fail — notifies once as a new actionable event. Rules out a row-derived timestamp (the pre-fix double-notify) and a cause-only key (which would silence a repeat failure the operator must act on). Amended in review 2026-09-18.
- A cause returning to an earlier value is deduplicated on purpose. Rules out a change-sequence key; unreachable today, since the only marker rewrite is to `failed` (`rewriteSettledMarkerAfterFailedRepublication`).
- The incident's `cause` is the marker cause (`completed|failed|killed`), not a row's `terminalCause`. Rules out passing row causes such as `completion_commit_failed` to the sink.
- The completed-with-failure-cause publication-tail path is dropped from `invocationTerminal`; republication failure reaches the operator via the marker rewrite to `failed`.
- Exclusions stay row-based, not marker-based: any row in the invocation with `status === "blocked"`, or with `terminalCause === "run_timeout"`, derives no incident. A timed-out invocation settles the marker as `failed` (`daemon-workflow-admission-handlers.ts`) and the marker does not record the cause run, so a marker-only derivation would double-notify with `run-timeout`; a blocked invocation still settles `completed|failed`. Rules out keying the timeout exclusion on marker cause `killed`, which never occurs for timeouts.
- Candidate selection in `collectWorkflowInvocations` stays row-recency (terminal rows inside the recency window); the marker is read once per candidate invocation. The delivered-through skip checks the ledger for `terminal:${marker.cause}` instead of comparing transition timestamps to row writes, so sibling rows load only for undelivered invocations. Rules out retaining `transitionTimestamp`, which cannot parse the new key, and out selecting candidates by marker `settledAt` (would need a marker scan of history).
- Remove `isWorkflowInvocationLive` wiring: the `deriveOperatorIncidents` option, `operator-notification-sweep.ts` deps, `reconcileNotificationKeyFormat`, and `daemon.ts`; its only consumer was the dropped rollup path. Keep `workflowInvocationIsLive` (`daemon.ts`) and its test: `daemon-run-lifecycle-handlers.ts` still uses it. Rules out leaving a dead liveness parameter that no longer affects output.
- Bump `NOTIFICATION_KEY_FORMAT_VERSION` so `reconcileNotificationKeyFormat` marks already-settled invocations delivered under the new key. Reconcile only suppresses incidents with `sinceMs < daemonStartedAtMs`, so `sinceMs` is the marker's `settledAt`. Rules out a bespoke legacy-key translation.
- Invocations that settled before markers existed have no marker and no longer produce the incident. Rules out backfilling markers from row statuses.

## Acceptance criteria

- [x] An `operator-incidents` test with a review row `completed`, a running publication row, and no settled marker derives no `run-ad-hoc-terminal`; it fails against the pre-fix rollup (non-owning daemon fires on the `completed` row).
- [x] A test reproduces the `e9b69036` shape: a `completed` marker, one row settles `completed`, a sweep runs, a second row settles `completed` ~23 s later, another sweep runs; exactly one `run-ad-hoc-terminal` is delivered. It fails against the pre-fix timestamped transition.
- [x] A test writes the marker, delivers the incident, then rewrites a row's `status_changed_at`; the next sweep delivers nothing; it fails against the timestamped key.
- [x] A test with marker `completed` delivered, then marker rewritten to `failed` (republication failure), yields exactly two `run-ad-hoc-terminal` deliveries across sweeps, the second with `cause: "failed"`.
- [x] A test with a `run_timeout` row and a `failed` marker derives no `run-ad-hoc-terminal` (only `run-timeout` fires); it fails against a marker-only derivation.
- [x] A test with a `blocked` row and a `completed` or `failed` marker derives no `run-ad-hoc-terminal`; it fails without the blocked exclusion.
- [x] A test seeds the ledger with a pre-upgrade `terminal:<status>:<ms>` delivery for a settled invocation at the prior key-format version, with the marker's `settledAt` before daemon start; after key-format reconcile the sweep delivers nothing for it. It fails without the version bump.
- [x] The `isWorkflowInvocationLive` option, sweep dep, reconcile parameter, and `daemon.ts` wiring are gone; `bun run typecheck` passes with no leftover references.
- [x] `deriveOperatorIncidents` timed (median of 5) on a copy of the real `~/.jarvis` store, on `main` and on the branch, stays under 1.2x the `main` time and under 150 ms; both timings are recorded in the run summary.
- [x] `v2/docs/daemon-host.md` § Operator notifications and `v2/docs/operator-runbook.md` § Deciding a workflow is finished state that `run-ad-hoc-terminal` fires once per settled-marker cause, never without a marker, carries the marker cause (`completed|failed|killed`), and is not produced for invocations settled before markers existed.
- [x] `v2/docs/v1-behaviors.md` records the new ad-hoc terminal notification behavior (marker-derived, once per cause, marker cause as `cause`).
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.
