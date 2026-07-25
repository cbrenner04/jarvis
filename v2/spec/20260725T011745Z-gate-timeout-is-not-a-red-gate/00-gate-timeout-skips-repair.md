# 00 - Deadline-killed gate skips repair

## Problem

`bun run ready` exits `TIMEOUT_EXIT_CODE` (124) when a step is killed by its deadline
(`scripts/ready.ts`). Nothing carries that distinction past `createDefaultRunReadyGate`
(`v2/src/execution/ready-finalize.ts`), so `publishWithReadyRepair`
(`v2/src/execution/write-loop.ts:1098`) treats every `ReadyGateError` as a red gate: it logs
`ready_gate_repair`, reprompts the agent with a phantom failure, and burns an iteration per attempt.
Observed on PR #2121: two ~12-minute repair iterations against code the same gate passed green by
hand at the same commit, with the run log reporting `gateExitCode: 1`.

## Decisions

- Classify a deadline kill from two independent signals — gate exit `TIMEOUT_EXIT_CODE`, **or** a
  deadline-kill marker line in the captured gate output. Rules out exit-code-only detection: `bun run`
  does propagate 124 (verified), yet the observed incident reported `gateExitCode: 1`, so an
  exit-code-only guard risks shipping green as a production no-op.
- `scripts/ready.ts` owns the marker as an exported constant used to emit the deadline message; the
  harness imports it. Rules out a duplicated string literal in `v2/src` that silently drifts.
- The classification rides on `ReadyGateError` (a `timedOut` flag) and is set on both throw sites —
  the `bun run ready` gate and the required-integration runner. Rules out fixing only the `ready`
  path and leaving the integration scope laundering timeouts as red.
- A timed-out gate keeps the existing `ready_gate_failed` outcome kind (already `resumable`,
  `retryable`, `nextAction: resume`) and adds a distinct `ready_gate_timeout` log event naming the
  gate exit code. Rules out a new `WriteLoopOutcomeKind`, which ripples through
  `run-operator-error.ts`, CLI completion, and the operator taxonomy for no behavioral gain.
- A timed-out gate consumes no iteration and emits no `ready_gate_repair`; the run settles
  immediately for operator resume. Rules out silently re-running the gate in-process.
- Touching `scripts/**` is root tooling, so verification is the full `bun run test`, not the three
  slices named in the intent.
- Deferred to first consumer: automatic gate re-run on a deadline kill — pin when a caller needs it.
- Out of scope: the per-step budget model, and the `daemon-lifecycle` real-clock flake.

## Task checklist

- [ ] Export a deadline-kill marker constant from `scripts/ready.ts` and emit the existing deadline
      message through it.
- [ ] Classify gate failures in `v2/src/execution/ready-finalize.ts`; carry the result on
      `ReadyGateError` at both throw sites.
- [ ] Guard the repair loop in `publishWithReadyRepair`; emit `ready_gate_timeout`
      (`v2/src/persistence/log-stream.ts`).
- [ ] Docs.

## Acceptance criteria

- [ ] A new `write-loop.test.ts` test drives publication with a ready finalizer that throws a
      deadline-killed `ReadyGateError` and asserts the run settles `ready_gate_failed` with a
      `ready_gate_timeout` log event, no `ready_gate_repair` event, no agent reprompt, and
      `iterationsConsumed` unchanged; it fails against the pre-fix code, which repairs.
- [ ] The timeout is recognized from either signal: a gate failure with exit `124`, and a gate
      failure with exit `1` whose output carries the deadline-kill marker, both skip repair —
      asserted by tests that fail against the pre-fix code.
- [ ] A new `write-loop.test.ts` test asserts a genuinely failing gate (non-timeout exit, no marker
      in output) still enters the repair path and emits `ready_gate_repair`.
- [ ] A required-integration failure killed by the deadline is classified as timed out, asserted in
      `ready-finalize.test.ts`.
- [ ] Inverting the timeout guard in `publishWithReadyRepair`, and inverting each added
      classification condition, each fails at least one test; the timeout tests prove the absence of
      `ready_gate_repair` and of any consumed iteration.
- [ ] `bun run typecheck` and `bun run test` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` § Gate trust — a deadline-killed gate is a budget kill, not a red
  gate: it skips repair, logs `ready_gate_timeout`, settles `ready_gate_failed` for resume; how to
  tell it apart from a real red gate in `jarvis run log`; and that a `shared/**` diff scopes the gate
  to all three test slices, which is what pushes it into the deadline.
- `v2/docs/workflow-runner.md` — the repair-loop paragraph gains the timeout exclusion alongside the
  existing flip-failure exclusion.
