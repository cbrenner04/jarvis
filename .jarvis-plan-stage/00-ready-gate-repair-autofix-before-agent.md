# Ready-gate repair autofix before agent

Formatter-only `bun run check` failures exhaust bounded repair iterations because
`runReadyGateRepairLoop` reprompts an agent without running the repo's own autofix first.

## Decisions

- Run project autofix in `runReadyGateRepairLoop` after the repair fence allowset is frozen and
  before the first `runReadyRepairIteration` — rules out a pre-loop hook or formatter classifier
  outside the repair loop.
- Attempt autofix at most once per repair-loop entry (first red gate on this publication path) —
  rules out a fix/re-gate loop when the gate stays red.
- Autofix does not increment `repairAttempt`, `currentIterations`, or emit `ready_gate_repair` —
  rules out charging the bounded repair budget for mechanical formatting.
- Run autofix on every red gate entering repair, not only when output looks formatter-only —
  rules out harness-side failure parsing.
- Resolve the command from the registered project's `fixCommand` when set, else built-in
  `bun run fix`, with the same skip-when-absent package-manager script semantics as v1
  `runReadyAndCommit` — rules out hardcoding only `bun run fix` or ignoring per-project config.
- After autofix, validate staged candidates through `validateReadyGateRepairCompletion` against the
  frozen allowset before commit — rules out unguarded `git add -A` widening the repair commit.
- When autofix leaves the gate red, fall through to bounded agent repair with the full
  `MAX_READY_GATE_REPAIRS` budget — rules out treating non-autofixable lint as mechanical.
- When autofix greens the gate, commit in-scope changes and republish without invoking the repair
  agent — rules out requiring a write iteration when fix alone suffices.
- Deferred to first consumer: whether gate-only `run resume` replays autofix when re-entering repair
  with persisted fence provenance — pin when the resume path needs it.

## Work

- Add a ready-gate repair autofix step in `v2/src/execution/write-loop.ts` on the
  `publishWithReadyRepair` repair path.
- Reuse or extract v1 fix-command resolution and execution seams testable from
  `write-loop.test.ts`.
- Add regressions under the existing ready-gate repair describe block in
  `v2/src/execution/write-loop.test.ts`; add `Mutation checkpoint:` comments on the formatter-only
  and out-of-scope pinning tests naming the autofix-once guard and allowset-filter guard mutations.
- Update durable docs listed below.

## Acceptance criteria

- [ ] `write-loop.test.ts` test `ready-gate repair autofix greens a formatter-only red gate without
      repair iterations` drives a red gate whose only fix is formatting, asserts autofix runs once,
      the gate re-runs green, the run completes, zero `ready_gate_repair` events, and zero repair
      agent invocations; it fails against the pre-fix code.
- [ ] `write-loop.test.ts` test `ready-gate repair autofix runs once then preserves full agent repair
      budget` drives a red gate with both a formatter diff and a non-autofixable lint error, asserts
      autofix runs once, then agent repair receives the full `MAX_READY_GATE_REPAIRS` budget; it
      fails against the pre-fix code.
- [ ] `write-loop.test.ts` test `ready-gate repair autofix rejects out-of-scope formatter changes`
      freezes the fence, runs autofix that would format a path outside the allowset, returns
      `completion_commit_failed` naming that path before repair republish, and fails against the
      pre-fix code.
- [ ] In `write-loop.test.ts`, the documented autofix-once guard mutation on
      `ready-gate repair autofix greens a formatter-only red gate without repair iterations` turns
      that test RED. (Manual)
- [ ] In `write-loop.test.ts`, the documented allowset-filter mutation on
      `ready-gate repair autofix rejects out-of-scope formatter changes` turns that test RED.
      (Manual)
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — autofix after fence freeze, before the first repair agent; does not
  consume the repair budget.
- `v2/docs/operator-runbook.md` — ready-gate repair prose (~502) documents autofix-first ordering;
  delete the 2026-07-30 formatter-only stopgap bullet (`Formatter-only red gates exhaust the repair
  budget`).
- `v2/docs/v1-behaviors.md` — parity baseline for ready-gate repair autofix.
- `v2/docs/workflow-runner.md` — align ready-gate repair paragraph or cross-link to
  `write-behavior.md`.
