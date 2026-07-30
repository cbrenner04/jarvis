# Classify untouched-path ready-gate failures

## Problem

The per-file runner can name red test files, but finalization treats every attributed red gate as
repairable run-caused failure. Bounded repair then edits unrelated tests or suite policy to green
load flake outside the run's diff.

## Decision ledger

- Use `ready_gate_out_of_scope` as a failed, resumable finalization outcome;
  `jarvis run resume` retries finalization without agent repair — rules out reporting completion
  or requiring unrelated code edits.
- Allowed touched set is the union of `<baseRef>...HEAD` diff paths (including untracked) plus
  every file under the run's spec tree directory — rules out treating spec edits as outside scope.
- Classify only when marker-prefixed failing-file records identify every gate failure and every
  identified path is outside the allowed set — rules out partial or prose-based inference.
- Missing, malformed, or partial records; failures from non-test ready steps; and
  `requiredIntegrationScope` failures without complete records remain `ready_gate_failed` — rules
  out treating an unknown failure set as out of scope.
- Any identified failing path inside the allowed set keeps the whole gate on today's
  `ready_gate_failed` bounded-repair path — rules out hiding a mixed in-scope failure.
- Deadline-killed gates keep the existing timeout skip path — rules out classifying budget kills
  as out of scope.
- Operator detail names the outside paths and states they lie outside the run's touched set —
  rules out a bare outcome with no actionable evidence.
- Scope excludes repair-commit path fencing and `LOAD_SENSITIVE_FILES` policy — rules out absorbing
  the separate queued intents for those behaviors.

## Task checklist

- Parse exported failing-file records from captured gate output into `ReadyGateError`.
- Derive the allowed set from base-relative diff plus spec tree, then classify complete evidence.
- Thread `ready_gate_out_of_scope` through publication, workflow settlement, durable logs,
  operator-error projection, and resume admission without entering ready-gate repair.
- Preserve existing `ready_gate_failed`, gate-timeout, flip, mutation, smoke, and publication
  behavior outside the new classification.
- Update durable operator and behavior docs.

## Acceptance criteria

- [ ] `v2/src/execution/ready-finalize.test.ts` adds pre-fix-failing coverage that fully attributed
      failures outside the base diff plus spec tree become `ready_gate_out_of_scope` with the outside
      paths, while mixed, absent, malformed, or partial attribution remains `ready_gate_failed`.
- [ ] `v2/src/execution/write-loop.test.ts` adds pre-fix-failing coverage that a fully attributed
      untouched-path red gate settles `ready_gate_out_of_scope` with no `ready_gate_repair` event and
      unchanged `iterationsConsumed`, and that one in-scope failing path still enters bounded repair.
- [ ] `v2/src/execution/workflow-runner.test.ts` adds a pre-fix-failing workflow regression that
      settles an attributed untouched red gate as failed and resumable, emits no `ready_gate_repair`,
      performs no repair-agent invocation, and exposes detail that the named paths are outside the
      touched set; one in-scope failing path retains today's bounded `ready_gate_failed` repair
      behavior.
- [ ] `v2/src/daemon/run-operator-error.test.ts` proves `list`/`wait` projection names reason
      `ready_gate_out_of_scope` with retry-finalization recovery rather than repair guidance.
- [ ] `v2/src/daemon/daemon-resume.test.ts` admits `ready_gate_out_of_scope` for finalization retry
      and refuses repair re-entry; inverting admission turns that test RED.
- [ ] Inverting failure-record parsing, complete-attribution validation, all-paths-outside
      classification, or repair bypass turns its corresponding test RED; negative cases prove
      successful, mixed, unattributed, and deadline-killed gates are not misclassified and
      out-of-scope gates never invoke repair.
- [ ] `write-loop.test.ts` deadline-kill and bounded-repair tests and `workflow-runner.test.ts`
      `"caps ready gate repairs and settles as ready_gate_failed when exhausted"` stay green.

## Documentation updates

- `v2/docs/write-behavior.md` — attributable-path contract, fallback, settlement, and resume
  semantics.
- `v2/docs/operator-runbook.md` § Gate trust — untouched-path red is out of scope; retry
  finalization and review every repair commit's file list before merging.
- `v2/docs/v1-behaviors.md` — v2 parity delta for untouched-path ready-gate classification.
