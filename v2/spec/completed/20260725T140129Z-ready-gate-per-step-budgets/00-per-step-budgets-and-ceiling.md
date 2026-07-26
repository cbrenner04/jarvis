# Per-step budgets, run ceiling, and flake-retry reset

## Problem

`scripts/ready.ts` subtracts global elapsed time from one `parseTimeout()` value for every step
(`remainingMs = max(0, deadlineMs - elapsedMs)`). A ~9-minute aggregate test step leaves seconds
for `check`, `typecheck`, `install`, and `lint:md`, and the test flake-retry inherits only the
remainder of that shared pool. Timeout kills report only the total ms (`DEADLINE_KILL_MARKER`), not
which step or bound fired.

## Decisions

- Model each ready step with a **step budget** (per-command wall, sized to what that step does) plus a
  **run ceiling** from `JARVIS_READY_TIMEOUT_MS` / `DEFAULT_TIMEOUT_MS` (unchanged env surface).
  Rules out raising only `JARVIS_READY_TIMEOUT_MS` as the fix and rules out an uncapped sum of
  independent per-step budgets with no backstop.
- At step start, the armed timeout is `min(stepBudgetMs, max(0, ceilingMs - runElapsedMs))`; the
  step budget does not inherit prior steps' consumption. Rules out the pre-fix shared
  `deadlineMs - elapsedMs` pool across steps.
- Vocabulary mirrors the write loop (#2121): per-step budget ≈ `iterationTimeoutMs`-shaped wall per
  command; run ceiling ≈ hard ceiling over the whole `runReady` invocation — fixed per-step constants
  in `ready.ts` only, no daemon `iterationTimeoutMs` wiring. Rules out a second naming scheme on the
  script.
- **Orchestration seam:** `runReady({ runCommandFn })` passes each step the **armed timeout ms**
  already computed in `runReady` as `min(stepBudgetMs, max(0, ceilingMs - runElapsedMs))` (third
  argument to `runCommandFn` / `runCommand`). Orchestration tests record that value only; they must not
  re-derive budgets from env or duplicate resolver math in mocks.
- Advance **run elapsed** in agent-runnable orchestration tests via an injectable run clock / elapsed
  override on `runReady` (preferred) or a deliberate delay inside `runCommandFn` before returning —
  not wall-clock sleeps in spawn-boundary tests.
- Flake-retry (second invocation of the same test step after `isGenuineTestFailure`) arms a **fresh**
  step budget; only `runElapsedMs` for the ceiling continues from run start. Rules out charging the
  retry with `serialElapsed` against the shared pool.
- Per-step constants live in `scripts/ready.ts` (colocated resolver, no new package). Export step
  budget constants or a small resolver test hook so ceiling/orchestration tests assert attribution and
  armed ms without re-implementing resolution in test files. The aggregate `bun run test` budget must
  exceed measured worst-case full-suite duration on operator hardware with headroom for `shared/**` →
  all three test slices; non-test steps get smaller fixed budgets. Rules out one flat 10-minute number
  for every command.
- Deadline kills keep `TIMEOUT_EXIT_CODE` (124) and retain `DEADLINE_KILL_MARKER` as a substring so
  `isDeadlineKilledGate` (`v2/src/execution/ready-finalize.ts`) keeps working. Rules out a distinct
  exit code for per-step kills.
- Kill stderr distinguishes **step budget** vs **run ceiling** and names the step (`bun` + args) and
  the ms allotted for the bound that fired. Rules out a bare `deadline exceeded after Nms` with no
  step attribution.
- Deterministic budget orchestration tests use `runReady({ runCommandFn })`; spawn-boundary 124 and
  stderr shape tests stay in `v1/test/ready-script.sandbox-unrunnable.test.ts`. Rules out new
  wall-clock sleeps in agent-runnable spawn tests.
- Touching `scripts/**` is root tooling: verification is `bun run typecheck` and full `bun run test`.
- Out of scope: faster aggregate suite, daemon `iterationTimeoutMs` wiring, changing harness
  `execFileSync` gate timeouts.

## Task checklist

- [ ] Add step-budget resolution and run-ceiling enforcement in `scripts/ready.ts` (`runReady`,
      `runCommand`, flake-retry path); export budgets or resolver hook for tests.
- [ ] Extend deadline-kill stderr (step vs ceiling, step label, allotted ms) while preserving
      `DEADLINE_KILL_MARKER`.
- [ ] Add injectable run clock / elapsed override (or document `runCommandFn` delay pattern) for
      orchestration tests.
- [ ] Add regression tests for per-step armed isolation, flake-retry budget reset, ceiling backstop,
      attributed kills (both bounds), and exit 124 on both kill paths.
- [ ] Docs: `v2/docs/test-writing.md` (concrete test-step budget ms + scope), `v2/docs/v1-behaviors.md`
      (ready gate deadline / serial retry).

## Acceptance criteria

- [x] `v1/test/ready-script.sandbox-unrunnable.test.ts` test `later ready step arms full step budget when run elapsed is large` drives `runReady` with `runCommandFn` that records the armed timeout ms (third argument), advances run elapsed without completing the full step list (injectable clock / elapsed override or scoped `runCommandFn` delay), invokes a later step, and asserts its armed ms equals that step's full step budget (not `ceilingMs - runElapsedMs` alone); fails against the pre-fix shared `elapsedMs` subtraction on every step.
- [x] The same file, test `flake-retry arms a fresh step budget not the first attempt remainder`, records armed ms on the two test-step `runCommandFn` invocations after a genuine failure on the first and asserts the retry's armed ms matches the full test step budget; fails against the pre-fix `serialElapsed` / shared-pool path.
- [x] The same file, test `run ceiling terminates before per-step budgets would fully sum`, uses a low `JARVIS_READY_TIMEOUT_MS` with generous per-step constants (via exported budgets/resolver hook, not duplicated test math), asserts exit `124`, stderr attributes **run ceiling** with step label and allotted ms, and the run stops before all steps complete; fails if the ceiling guard is removed.
- [x] The same file, spawn tests `runCommand exits with 124 when the step budget binds` and `runCommand exits with 124 when the run ceiling binds` (or equivalent parameterized cases): step-budget case has ceiling headroom so the kill attributes **step budget**; ceiling case has step-budget headroom so the kill attributes **run ceiling**; both assert exit `124`, `DEADLINE_KILL_MARKER`, step label, allotted ms for the bound that fired, and fail on non-124 exits.
- [x] `v2/src/execution/ready-finalize.test.ts` tests `classifies gate failure with exit 124 as timed out` and `classifies gate failure with deadline marker in output as timed out` stay green.
- [x] `v1/test/ready-script.sandbox-unrunnable.test.ts` test `test timeout (exit code 124) does not trigger serial retry` stays green.
- [x] `v2/docs/test-writing.md` documents a concrete aggregate `bun run test` step budget in ms, scope (full suite / worst case `shared/**` → all three slices on operator hardware), that per-step budgets apply inside `bun run ready`, and `JARVIS_READY_TIMEOUT_MS` is the run ceiling only; `scripts/ready.ts` exports or documents the same test-step budget ms (constant + comment) matching the doc.
- [x] `bun run typecheck` and `bun run test` pass.

## Documentation updates

- `v2/docs/test-writing.md` — concrete ms for the aggregate `bun run test` step budget (measured
  worst-case full suite + headroom, `shared/**` → all three slices, operator hardware); per-step
  budgets inside `bun run ready`; `JARVIS_READY_TIMEOUT_MS` as run ceiling only; note updating the
  constant when suite duration drifts.
- `v2/docs/v1-behaviors.md` — ready-gate serial-retry bullet: per-step budgets, fresh budget on
  flake-retry, run ceiling backstop, attributed deadline kills (replace "remaining budget of the shared
  deadline" wording).
