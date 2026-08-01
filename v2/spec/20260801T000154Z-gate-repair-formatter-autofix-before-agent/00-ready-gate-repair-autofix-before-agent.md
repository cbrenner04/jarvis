# Ready-gate repair autofix before agent

Formatter-only `bun run check` failures exhaust bounded repair iterations because
`runReadyGateRepairLoop` reprompts an agent without running the repo's own autofix first.

## Decisions

- Run project autofix once per `publishWithReadyRepair` repair entry — after the repair fence
  allowset is frozen and **before** the repair `while` loop (not inside an iteration) — rules out a
  pre-loop hook, formatter classifier, or per-iteration autofix.
- Autofix runs on every repair entry, including gate-only resume and review-mutation publication
  tails (`maxIterations: 0`), not only the first implement publication — rules out the 2026-07-30
  manual-fix + resume recovery path.
- Success path: run autofix → validate staged candidates through `validateReadyGateRepairCompletion`
  against the frozen allowset → commit in-scope changes via `createCompletionCommitter` →
  republish/re-gate; emit no `ready_gate_repair`; do not increment `repairAttempt` or
  `iterationsConsumed` — rules out charging the bounded repair budget for mechanical formatting.
- Autofix commits keep the retained completion subject and `Jarvis-Agent:` trailer and add
  `Jarvis-Ready-Gate: autofix` so they are distinguishable from agent repair commits — rules out
  indistinguishable repair/autofix history.
- Attempt autofix at most once per `publishWithReadyRepair` repair entry; a still-red gate after a
  **successful** autofix falls through to bounded agent repair with the full `MAX_READY_GATE_REPAIRS`
  budget — rules out a fix/re-gate loop.
- Run autofix on every red gate entering repair, not only when output looks formatter-only — rules
  out harness-side failure parsing.
- Resolve autofix from the registered project's `fixCommand` when set, else built-in `bun run fix`,
  with the same skip-when-absent package-manager script semantics as v1 `runReadyAndCommit`; extract
  or share the v1 resolution/execution seam and thread project config into the repair loop — rules
  out hardcoding only `bun run fix` or leaving `fixCommand` unwired in v2.
- Autofix non-zero exit or timeout fails closed (v1 `FixCommandError` shape): settle without
  entering agent repair; do not fall through on a crashed or timed-out fix command — rules out
  charging agents for fix-command failures or republishing with a corrupted worktree. Timeout binds
  to `iterationTimeoutMs`. Fall through to agent repair only when autofix exits successfully and the
  gate stays red.
- When autofix greens the gate, commit in-scope changes and republish without invoking the repair
  agent — rules out requiring a write iteration when fix alone suffices.

## Work

- Add a ready-gate repair autofix step in `v2/src/execution/write-loop.ts` on the
  `publishWithReadyRepair` repair path, before the repair `while` loop.
- Extract or share v1 fix-command resolution and execution; plumb registered-project `fixCommand`
  into the repair loop; test from `write-loop.test.ts`.
- Add regressions under the existing ready-gate repair describe block in
  `v2/src/execution/write-loop.test.ts`; add `Mutation checkpoint:` comments on the formatter-only
  and out-of-scope pinning tests naming the autofix-once guard and allowset-filter guard mutations.
- Update durable docs listed below.

## Acceptance criteria

- [x] `write-loop.test.ts` test `ready-gate repair autofix greens a formatter-only red gate without
      repair iterations` drives a red gate whose only fix is formatting, asserts autofix runs once,
      the gate re-runs green, publication succeeds (`outcome.kind === "success"`, no
      `ready_gate_failed`), zero `ready_gate_repair` events, zero repair agent invocations, and
      `repairAttempt` / `iterationsConsumed` unchanged by autofix; it fails against the pre-fix code.
- [x] `write-loop.test.ts` test `ready-gate repair autofix runs once then preserves full agent repair
      budget` drives a red gate with both a formatter diff and a non-autofixable lint error, asserts
      autofix runs exactly once, `repairAttempt` and `iterationsConsumed` are unchanged by autofix,
      then exactly three `ready_gate_repair` events when all agent attempts stay red; it fails
      against the pre-fix code.
- [x] `write-loop.test.ts` test `ready-gate repair autofix rejects out-of-scope formatter changes`
      freezes the fence, runs autofix that would format a path outside the allowset, returns
      `completion_commit_failed` naming that path before repair republish, and fails against the
      pre-fix code.
- [x] `write-loop.test.ts` test `ready-gate repair autofix greens formatter-only red gate on
      gate-only resume without agent` drives `publishWithReadyRepair` with `maxIterations: 0` and
      formatter-only dirt, asserts autofix runs once, the gate re-gates green, publication succeeds,
      and no repair agent runs; it fails against the pre-fix code.
- [x] `write-loop.test.ts` test `ready-gate repair autofix invokes configured fixCommand` asserts
      a registered-project `fixCommand` runs instead of built-in `bun run fix`; it fails against the
      pre-fix code.
- [ ] In `write-loop.test.ts`, the documented autofix-once guard mutation on
      `ready-gate repair autofix greens a formatter-only red gate without repair iterations` turns
      that test RED. (Manual)
- [ ] In `write-loop.test.ts`, the documented allowset-filter mutation on
      `ready-gate repair autofix rejects out-of-scope formatter changes` turns that test RED.
      (Manual)
- [x] `write-loop.test.ts` tests `deadline-killed gate (exit 124) skips repair and emits
      ready_gate_timeout` and `deadline-killed gate (marker in output) skips repair and emits
      ready_gate_timeout` stay green.
- [x] `write-loop.test.ts` `ready-gate repair fence` describe block stays green.
- [x] `v2/docs/write-behavior.md` documents autofix once per `publishWithReadyRepair` repair entry
      after fence freeze and before the first repair agent, repair-budget exclusion, and
      `Jarvis-Ready-Gate: autofix` commit attribution; updates the canonical ready-gate repair
      fence paragraph and deduplicates the duplicated block (~429–430).
- [x] `v2/docs/operator-runbook.md` ready-gate repair prose (~502) documents autofix-first ordering
      and repair-budget exclusion; deletes or updates stale manual-fix guidance at ~1181
      (`Formatter-only red gates exhaust the repair budget`), ~1449 (pre-`red-gate-feeds-back` hand
      `bun run fix`), and any remaining "run `bun run fix` and re-gate by hand" stopgap.
- [x] `v2/docs/v1-behaviors.md` records v2 ready-gate-repair autofix (once per repair entry, before
      agent repair, fence-validated commit, no repair-budget charge) and its analogy to v1
      completion-gate autofix in `runReadyAndCommit` — not v1 bounded repair.
- [x] `v2/docs/workflow-runner.md` ready-gate repair paragraph documents autofix-first ordering or
      cross-links `write-behavior.md` for the same contract.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — autofix after fence freeze, before the repair `while` loop; repair
  budget exclusion; `Jarvis-Ready-Gate: autofix` attribution; dedupe ~429–430.
- `v2/docs/operator-runbook.md` — autofix-first ordering (~502); delete/update manual-fix stopgaps
  (~1181, ~1449).
- `v2/docs/v1-behaviors.md` — v2 ready-gate-repair autofix plus v1 `runReadyAndCommit` analogy.
- `v2/docs/workflow-runner.md` — align ready-gate repair paragraph or cross-link to
  `write-behavior.md`.
