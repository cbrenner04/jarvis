# Bounded mutation-coverage repair

Recovery from `00` re-verifies mutations without an agent, so a mutation that survived before
still survives: the tail can only re-run the gate, never close the coverage gap. Repair needs an
agent iteration in the retained worktree, bounded like `MAX_READY_GATE_REPAIRS`
(`v2/src/execution/write-loop.ts:163`, currently `3`) bounds `write.ready-repair`
(`runReadyRepairIteration`, `write-loop.ts:1115`), so an unkillable mutation ends in a named
terminal outcome instead of looping.

## Decisions

- **Repair reuses the ready-gate-repair shape**: a distinct `write.mutation-repair` prompt id
  carrying the surviving mutation, its source file and line, and the dual-constraint detail (the
  same fields `SurvivingMutationError` already carries at `write-loop.ts:1277`); rules out
  re-invoking `patch.prompt.body`, which would re-enter spec work over already-ticked criteria.
- **The attempt budget is a module constant beside `MAX_READY_GATE_REPAIRS`**:
  `MAX_MUTATION_REPAIR_ATTEMPTS = 3`; rules out a new machine-config key with no second consumer.
- **Budget composition with the ready-gate-repair loop**: the two bounds are independent and stack.
  Each mutation-repair attempt, once it produces a commit, runs through the *existing*
  `publishWithReadyRepair` gate-repair loop (bounded by `MAX_READY_GATE_REPAIRS`) unchanged. Worst
  case total agent iterations for one `implement.recover` invocation is
  `MAX_MUTATION_REPAIR_ATTEMPTS × (1 + MAX_READY_GATE_REPAIRS)` = `3 × 4` = `12`: up to 3
  mutation-repair attempts, each potentially followed by up to 3 gate-repair iterations on that
  attempt's own commit before mutation re-verification even runs again. This is documented, not
  reduced — the two loops answer different failures (surviving mutation vs. gate command failure)
  and neither substitutes for the other.
- **Repair execution parameters come from the current `implement.recover` invocation, not the
  original run's stored args.** Resume's existing `inertResumeWriteLoopInput`
  (`workflow-runner.ts:2391`) deliberately carries `maxIterations: 0` and no agent bindings — "no
  agent bindings exist on resume". For implement-initiated recovery, `00`'s `implement.recover`
  request payload is extended with the implement-role agent bindings, timeout, and iteration
  decoration that a fresh `run workflow implement` would have resolved for its `write` step (the
  same values `loadImplementWorkflowSteps`/`resolveWorkflowPreset` produce today) — never
  reconstructed from the failed row's original, possibly stale, stored invocation. A plain `jarvis
  run resume <runId>` supplies none of this and keeps today's agent-free tail unchanged.
- **Re-verification after a repair iteration is full, not surface-scoped**: it reruns
  `verifyDiffDerivedMutations({ worktreePath, runBase: baseRef })` exactly as the initial gate does
  (`runReadyFinalizer`, `write-loop.ts:1241`) — the whole branch diff since `baseRef`, not a
  narrower slice limited to the repair's own edit. This matches existing mutation-verification
  scope and avoids a second, inconsistent notion of "affected surface."
- **Each repair iteration commits its changes and re-verifies before the gate**; rules out
  publishing untested repair work or trusting the agent's own report that the mutation is dead.
- **A repair iteration that ends blocked or unsettled (timeout/abort) stops the tail immediately**,
  without retrying within the same invocation, and settles the same terminal outcome as budget
  exhaustion: `mutation_repair_exhausted`. One terminal outcome covers "tried the full budget and
  the mutation still survives," "the agent reported blocked," and "an iteration never settled" —
  all three mean recovery cannot make further automatic progress and the operator must intervene;
  splitting them into separate outcome kinds would triple the operator-error mapping in `12` below
  for no behavioral difference (identical retryability and next action in every case). The stored
  failure message on the row distinguishes which of the three occurred, for operator diagnosis.
- **Budget exhaustion (in any of the three forms above) settles `mutation_repair_exhausted` on the
  owning row and is not auto-recoverable**: it is excluded from `00`'s admission set (only
  `surviving_mutation_failed` / `ready_gate_failed` / `completion_commit_failed` admit), so a later
  `jarvis run workflow implement` on that spec returns `implement.already_complete` and starts no
  repair; rules out an unbounded repair loop spread across invocations. The operator's only
  remedy is a manual fix and hand-publish, or unticking criteria to force a fresh implement run.
- **`--detach` interaction**: a repair iteration runs synchronously inside the same
  `implement.recover` dispatch `00` defines; `--detach` controls only whether the CLI blocks for
  that dispatch's terminal response (per `00`), not whether repair iterations themselves run
  detached — there is no independent detach knob for repair.

## Tasks

- Add the `write.mutation-repair` prompt and its bounded repair iteration
  (`runMutationRepairIteration`, mirroring `runReadyRepairIteration`) to the mutation-finalization
  tail, gated on `surviving_mutation_failed` re-verification results only.
- Extend the `implement.recover` request/dispatch from `00` to carry implement-role bindings,
  timeout, and iteration decoration through to the repair loop; leave the plain `run resume` path
  untouched (still `inertResumeWriteLoopInput`, still agent-free).
- Add the `mutation_repair_exhausted` reason to `RUN_OPERATOR_ERROR_REASONS`
  (`v2/src/daemon/run-operator-error.ts:8`) with `retryable: false` and `nextAction: "inspect_spec"`,
  and add its next-action guidance string alongside the existing
  `surviving_mutation_failed: "fix surviving-mutation test coverage, then jarvis run resume"` entry
  (`run-operator-error.ts:239`) — update that existing string's applicability note so it's clear it
  covers the pre-exhaustion, still-admissible case, not the exhausted one.
- Cover kill-on-repair, exhaustion (all three forms), and refusal to re-admit an exhausted row.
- Align write-behavior, workflow-runner, operator, and v1-behavior docs.

## Acceptance criteria

- [ ] A new test in `v2/src/execution/workflow-runner.test.ts` drives implement-initiated recovery
      whose first re-verification finds a surviving mutation, proves one `write.mutation-repair`
      iteration runs in the retained worktree using implement-role bindings supplied by the current
      invocation (not the original run's stored args), and proves the killed mutation then passes
      full re-verification, the ready gate, publication, and settles `completed`; it fails against
      the baseline.
- [ ] Repair that never kills the mutation across `MAX_MUTATION_REPAIR_ATTEMPTS` attempts stops at
      that bound and settles `mutation_repair_exhausted`; the run row is failed and its operator
      error reports `mutation_repair_exhausted` with `retryable: false` and `nextAction:
      "inspect_spec"`.
- [ ] A repair iteration that settles `blocked`, and separately one that times out unsettled, each
      independently stop the tail without publishing and settle `mutation_repair_exhausted` (not a
      fresh budget-exhaustion count) — proving the tail does not retry past a blocked/unsettled
      iteration within the same invocation.
- [ ] `jarvis run workflow implement` against a spec whose latest lineage row settled
      `mutation_repair_exhausted` returns `implement.already_complete` (not `implement.recover`
      admission) and starts no repair, no worktree claim, no agent invocation.
- [ ] Repair records zero `patch.prompt.body` invocations and leaves every acceptance criterion
      ticked.
- [ ] A repair iteration's changes are committed and full mutation re-verification runs before the
      ready gate; a gate-repair loop triggered by that commit (bounded by the existing
      `MAX_READY_GATE_REPAIRS`) is exercised at least once in the same test run, proving the two
      budgets compose rather than one silently absorbing the other.
- [ ] `jarvis run resume` on the same owning row still runs the agent-free tail (`inertResumeWriteLoopInput`,
      `maxIterations: 0`) and invokes no repair agent; `v2/src/daemon/daemon-resume.test.ts`
      review-mutation coverage stays green.
- [ ] Inverting the `MAX_MUTATION_REPAIR_ATTEMPTS` bound and inverting the implement-initiated
      bindings guard (so `run resume` would also receive bindings) each independently turn their
      corresponding negative case above RED, proving in each case that no repair agent ran beyond
      the bound, or that no repair agent ran at all on a plain resume.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — document the `write.mutation-repair` prompt, its placeholders, and
  `MAX_MUTATION_REPAIR_ATTEMPTS`.
- `v2/docs/workflow-runner.md` § Ready gate repair — document bounded mutation-repair continuation
  alongside it, the two bounds' composition and worst-case iteration count, and
  `mutation_repair_exhausted`.
- `v2/docs/operator-runbook.md` § Publication / completion failures — document the exhausted
  outcome, its manual remedy, and the updated applicability of the existing
  `surviving_mutation_failed` → `jarvis run resume` guidance now that it only covers the
  pre-exhaustion case.
- `v2/docs/v1-behaviors.md` — record the new terminal outcome and the agent-bearing recovery
  contract.
