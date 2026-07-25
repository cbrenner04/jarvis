# The TUI monitor hides killed runs, miscounts attempts, and ships test flags

## Problem

Follow-ups from `20260724T230804Z-tui-limits-terminal-rows-to-one-hour` (#2123) plus the two
unconsumed defects from `tui-cannot-distinguish-a-workflows-runs` (its role-label defect shipped
inside #2123). The window and collapse behavior are correct and mutation-verified; these are the
edges left over.

### 1. Killed, interrupted, and spawn-failed runs vanish from the monitor

`terminalRunInLiveWindow(undefined, …)` returns false, so a terminal row with no `finishedAtMs` is
dropped outright. `finishedAtMs` is the max non-null `attempt.completed_at`
(`v2/src/daemon/daemon.ts:385-395`), and orphan reconciliation sets status **only**
(`v2/src/persistence/state-store.ts:588-592`) — it never writes `completed_at`, which is produced
solely by the attempt-commit path (`:524-528`). So a `killed` row with no completed attempt renders
zero rows, as does a spawn-boundary `failed` row with `attempt_count 0`. These are precisely the rows
an operator opens the TUI to find. A killed run that *did* complete earlier attempts keeps a stale
`finishedAtMs` (last successful iteration, not kill time) and can age out early.

The spec is silent on `undefined`, so this is an unforced regression rather than a spec requirement.

`blocked` is also in `TERMINAL_RUN_STATUSES` (`state-store.ts:34-38`), so blocked runs — whose whole
point is that they carry a `worktreePath` to resumable work — age out of the monitor after an hour
with no warning in the docs.

### 2. Terminal rows disagree with their own step snapshot, and `attempts` is always 0

Observed 2026-07-20 on `20260721T005518Z-cleanup-stranded-owner-by-branch`:

```text
implement        implement  pending    attempts=0
implement-review actuator   completed  attempts=0
```

The `implement` step reads `pending` on a run whose outcome is `completed` — the step snapshot and
the run outcome disagree. And `attempts=0` shows on every row, including rows that provably invoked
an agent, so the count carries no information.

### 3. Test-inversion flags are exported from production modules

`setInvertTerminalWindowFilterForTest` / `setInvertTerminalRowCapFilterForTest`
(`v2/src/tui/tui-monitor-terminal-window.ts:12-21`) and `setInvertWorkflowCollapseForTest`
(`v2/src/tui/tui-monitor-workflow-collapse.ts:5-9`) are mutable globals in shipped code. The three
"guard inversion" acceptance criteria are satisfied by toggling these flags, so those tests would
stay green if the guard itself were deleted — the real coverage comes from the positive tests. Worse,
production policy is expressed *through* a test flag:

```ts
if (finishedAtMs === undefined) return invertTerminalWindowFilterForTest;
```

### 4. Expansion is rendered but never driven

No test exercises `toggleSelectedWorkflowExpansion` (`v2/src/tui/tui-entry.tsx:370-386`) or the `e`
keybinding (`tui-ink-monitor.tsx:79-81`); every expansion test injects
`expandedWorkflowInvocationIds` into state directly, and the ink test stubs the control as a no-op
(`tui-ink-monitor.test.tsx:109`). This repo has shipped TUI wiring that renders but does not respond
(`tui-tests-bypass-the-render-path`).

## Decisions

- A terminal row with no `finishedAtMs` is treated as **in-window** and rendered, not dropped; rules
  out the current fail-closed policy that hides killed, interrupted, and spawn-failed runs.
- Prefer giving reconciliation a real finish time over special-casing `undefined` forever — if
  `killed` / `interrupted` can carry an accurate timestamp, set it; the in-window fallback stays as
  the guard for rows that genuinely have none. Rules out fixing only the renderer and leaving the
  store's terminal rows timestamp-less.
- A terminal run's step snapshot must not report `pending`; reconcile step state at the completion
  boundary so the panel agrees with the outcome.
- `attempts` reflects actual agent invocations for the step; a step that invoked an agent never reads
  `0`. Rules out leaving a placeholder counter on display.
- Prefer surfacing state the store already holds over new persisted fields; add a field only where the
  data genuinely is not recorded.
- Delete all three `setInvert*ForTest` exports and rewrite those acceptance criteria to mutate the
  guard, not a flag; production must contain no test-only mutable state. Rules out keeping the flags
  because the criteria are literally satisfied.
- Cover expansion through the real control path (`e` keybinding → `toggleSelectedWorkflowExpansion` →
  rendered constituent rows), not by seeding expansion state; rules out the render-without-respond gap
  this repo has shipped before.
- Out of scope: the one-hour duration and twenty-row cap themselves — the operator pinned both.

## Acceptance criteria

- [ ] A monitor test with a `killed` row whose attempts have no `completed_at` asserts the row
      renders; it fails against the pre-fix filter, which drops it.
- [ ] The same for a spawn-boundary `failed` row with `attempt_count 0` and for an `interrupted` row.
- [ ] No terminal run renders a `pending` step; step state at the completion boundary matches the run
      outcome.
- [ ] `attempts` equals the step's agent invocation count and is non-zero for a step that invoked an
      agent.
- [ ] `grep -r "ForTest" v2/src/tui/` returns nothing, and the window, cap, and collapse criteria are
      each proven by mutating the guard itself — deleting a guard turns its test red.
- [ ] A test drives the `e` keybinding through the ink control and asserts the constituent rows appear
      in rendered output, then disappear on a second press; stubbing the control as a no-op fails it.
- [ ] Coverage asserts rendered rows, not just view-model state — see `v2/docs/test-writing.md` on TUI
      tests bypassing the render path.
- [ ] `v2/docs/operator-runbook.md` § Observe states that `blocked` rows age out of the monitor after
      an hour and names `jarvis run list --status blocked` as the way to find them.

## Documentation updates

- `v2/docs/operator-runbook.md` § Observe — which terminal rows the live window keeps, where to find
  the ones it does not, and reading a multi-run workflow in the TUI.
- `v2/docs/test-writing.md` — guard-inversion criteria are met by mutating the guard, never by a
  production test flag.

## Prerequisites

- `20260724T230804Z-tui-limits-terminal-rows-to-one-hour` merged (#2123).
