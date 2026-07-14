# Every ok-result iteration writes exactly one invocation row

Two paths in the `result.kind === "ok"` branch of `v1/src/modes/patch/iteration.ts` return without
writing any telemetry row: the edited-but-unticked branch (`worktreeCompletionBlocker` set) both
when it loops (below `EDITED_UNTICKED_BOUND`) and when it exits 6. A run that ends there on its
first iteration writes *nothing* to `runs.jsonl` — `run.ts` only emits the synthetic harness
`run_terminal` row when at least one telemetry write already happened. The agent ran, spent money,
and left a dirty worktree; the cost sheets see no run.

## Decisions

- Emit an invocation row (no `record_role`) from both edited-unticked paths, carrying the same
  `usageCost` / `last_output_age_ms` / `warnings` fields the `criteria-progress` row carries.
- Exit reasons: `dirty-worktree` for the exit-6 path (matching `mapExitCodeToReason(6)`),
  `edited-unticked` for the loop-back path. Rules out reusing `no-progress`, which means the
  opposite (the agent changed nothing).
- These rows are `kind: "ok"`, so they count as completed patch iterations in the run summary. That
  is the correction: the iteration did run.

## Acceptance criteria

- [ ] A patch iteration that edits files, ticks no criteria, and exits 6 writes one `runs.jsonl`
      invocation row with `exit_reason: "dirty-worktree"` carrying `usage`, `usage_source`,
      `cost_usd`, `cost_source`, and `last_output_age_ms`.
- [ ] A patch iteration that edits files, ticks no criteria, and loops back (below the
      edited-unticked bound) writes one such row with `exit_reason: "edited-unticked"`.
- [ ] A run whose only iteration exits 6 leaves a non-empty `runs.jsonl` for its namespace, including
      the harness `run_terminal` row.
- [ ] No `ok`-result iteration writes more than one invocation row.
- [ ] Existing patch telemetry and run-summary tests (`v1/test/run.test.ts`,
      `v1/test/run-summary.test.ts`) stay green.

## Documentation updates

- `v1/docs/run-loop.md` — add `edited-unticked` to the patch exit-reason vocabulary and note that
  every `ok`-result iteration writes one usage-bearing invocation row.
- `v2/docs/v1-behaviors.md` — record that edited-unticked iterations (loop-back and exit 6) now emit
  usage-bearing invocation rows and count as patch iterations in the run summary.
