# Finalization outcome outranks the repair attempt boundary

Observed on run `b1d7ba2b` (spec `20260724T230804Z-tui-limits-terminal-rows-to-one-hour`): the ready-gate
repair loop exhausted its budget on a `blocked` iteration, so the row holds
`boundary_committed { outcomeKind: "blocked" }` followed by
`loop_finished { loopOutcomeKind: "ready_gate_failed", resumable: true }` on a `failed` row.

`composeRunOperatorError` (`v2/src/daemon/run-operator-error.ts`) consults last-attempt detail before the
`loop_finished` mapping for `failed` / `blocked` rows, so the `blocked` repair attempt composes
`agent_blocked` / `inspect_spec` and `run resume` refuses `terminal_run: Cannot resume a failed run` — while
the loop record advertises `resumable: true`. `v2/docs/write-behavior.md` states a blocked repair returns
retryable `ready_gate_failed`.

## Decisions

- A terminal `loop_finished` advertising `resumable: true` for a loop-level finalization outcome
  (`ready_gate_failed`, `surviving_mutation_failed`, `completion_commit_failed`, `iteration_commit_failed`)
  outranks last-attempt detail on `failed` / `blocked` rows; rules out keeping attempt precedence and
  special-casing only the `blocked` repair outcome.
- Keep the stale-log guard for the durable-status resumable kinds (`paused`, `budget-exhausted`, `killed`):
  those are reported by the status machine, not the finalization tail, so a stale record must still lose to a
  `failed` row. Rules out a blanket "log resumable wins" that regresses the demotion cases.
- Fix composition, not `isResumeAdmitted`; admission already derives from `nextAction`, so `list`, `wait`, and
  `resume` correct together. Rules out a resume-only admission patch.

## Tasks

- Reorder `composeRunOperatorError` so a resumable finalization `loop_finished` wins over attempt detail.
- Regress in `daemon-resume.test.ts`: `ready_gate_failed` + `blocked` last attempt is admitted.
- Regress in `run-operator-error.test.ts`: composed reason/`nextAction` for that row shape.

## Acceptance criteria

- [x] A `failed` row whose last committed attempt is `blocked` and whose terminal
      `loop_finished` is `ready_gate_failed` with `resumable: true` is admitted by `jarvis run resume` and
      respawns from its persisted snapshot; a new `v2/src/daemon/daemon-resume.test.ts` case fails against
      pre-fix code with `terminal_run: Cannot resume a failed run`.
- [x] `composeRunOperatorError` reports `reason: "ready_gate_failed"`, `retryable: true`,
      `nextAction: "resume"` for that row shape, covered by a new `v2/src/daemon/run-operator-error.test.ts`
      case that fails pre-fix.
- [x] Inverting the added precedence guard fails a test; the negative direction proves attempt detail still
      wins when the terminal record is not a resumable finalization outcome.
- [x] `run-operator-error.test.ts` stale-log tests (`failed` + `loopOutcomeKind: "paused"` /
      `"budget-exhausted"` compose `harness_failure` / `stop`) stay green.
- [x] `bun run typecheck`, `bun run test:v2`, `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` § Operator error on `list` and `wait`, **Tie-break** — a resumable finalization
  `loop_finished` outranks last-attempt detail; the stale-log guard is scoped to the durable-status
  resumable kinds.
- `v2/docs/v1-behaviors.md` — a ready-gate repair that ends `blocked` stays resumable via `jarvis run resume`.
