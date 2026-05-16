# 08 — End-of-run summary

## Problem

After `jarvis run` finishes — whether the spec completed, an agent ran out
of quota, the run timed out, or the user hit Ctrl-C — there is no
human-readable summary of what the run cost. Users have to grep the
telemetry JSONL with `jq` to add things up.

This subspec adds an end-of-run summary printed to stdout, sourced from
the telemetry records written during the run, that totals tokens and cost
per agent and overall, with explicit annotations when sources are mixed
(some iterations had real usage data, some did not).

## Decisions

- **Source of truth: telemetry records, not in-memory accumulation.**
  At end-of-run, the harness reads the session-scoped telemetry records
  it wrote during this run and aggregates them. Rationale: if the
  process is killed mid-run, the next reconciliation tool (or the user)
  can compute the same summary from the JSONL alone. No in-memory state
  is privileged. The downside — re-reading a file we just wrote — is
  trivial in practice.
- **Identifying "this run's" records.** `appendTelemetryLine` writes a
  `namespace` (project + spec) but no run ID. To filter to just this
  run, capture the start timestamp at the top of `runCommand` and
  filter records where `ts >= start_ts && namespace ===
  this_namespace`. This is best-effort; concurrent runs against the
  same spec on the same machine could overlap, which we treat as a
  user error (worktree locking already discourages it).
- **Always print the summary.** Print on every exit code, including
  failures, except when the harness exits before any agent has run
  (e.g. preflight failure, `gh` not authenticated, spec path missing).
  The summary header explicitly states the run's exit reason so
  failure-case summaries aren't misleading.
- **Where it prints.** Stdout, after all other run output, before the
  process exits. Always goes to stdout regardless of exit code (we are
  not a UNIX tool that conventionally suppresses output on failure;
  `jarvis run`'s stdout is already mixed-purpose).
- **Format.**

  ```
  ─── run summary ───
  spec: spec/foo/index.md
  exit reason: criteria-complete
  iterations: 7
  duration: 14m 23s

  agent              tokens_in  tokens_out  cache_r   cache_w   cost     source
  claude (5 iters)   42,000     12,300      8,400     0         $0.81    agent
  codex (2 iters)    18,200     4,100       0         0         $0.07    computed
  ───────────────────────────────────────────────────────────────────────
  total              60,200     16,400      8,400     0         $0.88

  notes:
    - 1 iteration had no usage data (claude parse failure on iteration 3).
  ```

  - "tokens_in" = `input_tokens`. "cache_r" / "cache_w" =
    `cache_read_input_tokens` / `cache_creation_input_tokens`. Cache
    columns omitted entirely if every row in them is 0 (cleaner for
    runs that don't touch caches).
  - Per-agent rows aggregate over iterations of that agent.
  - "source" column shows the dominant `cost_source` for that agent's
    iterations: `agent` if any iteration had `cost_source: "agent"`,
    else `computed` if any had `"computed"`, else `no-price`, else
    `unavailable`. Mixed sources are noted in the `notes:` block, not
    in the column.
  - Costs render as `$X.XX` (two decimals) when known, `—` when
    `cost_usd` is null for every iteration in that agent's group. The
    total row's cost is `$X.XX` of the sum of known costs, with a
    `notes:` entry if some iterations contributed `null` cost.
  - The `notes:` block is omitted if there are no notes.
- **Notes block contents** (each as a single line under `notes:`):
  - Number of iterations with `usage_source: "unavailable"` (per
    agent): `<n> iteration(s) under <agent> had no usage data
    (usage_source=unavailable).`
  - Number of iterations with `usage_source: "agent"` but
    `cost_source: "no-price"`: `<n> iteration(s) under <agent> had
    usage data but no price-table entry for the model.`
  - Number of iterations with parse failures (counted via warnings
    persisted to telemetry — see implementation note below).
  - Mention of mixed cost sources within an agent: `<agent> mixes
    cost sources: <source-a>, <source-b>.`
- **Implementation note on parse-failure visibility.** If subspec 04 /
  05 / 06's warnings-via-`AgentResult.warnings` flow does not persist
  to the telemetry record itself (it doesn't, in the current sketch —
  warnings are forwarded to `harness` log lines, not attached to the
  per-iteration record), this subspec adds an optional `warnings:
  string[]` field to `TelemetryRecord` that the harness populates when
  forwarding warnings. The summary aggregator counts records with
  non-empty `warnings` per agent.
- **No JSON output flag** in v1. If users want machine-readable totals
  they read the telemetry JSONL directly. (Could add `jarvis run
  --summary-json` later if there is demand; explicit non-goal here.)
- **No coloring.** Plain text. Matches the rest of `jarvis run` output.

## Tasks

- [ ] Add a `runSummary({ telemetryPath, namespace, startTs, exitReason,
      iterations, durationMs, specPath })` helper at
      `src/run-summary.ts` that:
      - Reads the JSONL file.
      - Filters records by namespace and `ts >= startTs`.
      - Aggregates per agent (input/output/cache_r/cache_w tokens,
        sum of `cost_usd` ignoring nulls, dominant `cost_source`,
        iteration count).
      - Builds the formatted multi-line string per the format above.
      - Returns the string. Pure function modulo file read; testable
        with a fixture telemetry file.
- [ ] Extend `src/telemetry.ts` `TelemetryRecord` with optional
      `warnings?: string[]` field (additive, nullable).
- [ ] Update `src/modes/patch/run.ts`:
      - Capture `runStartTs` at the top of `runCommand`.
      - In the `finalize` flow (which already runs on every exit
        path), call `runSummary` and print the result to stdout.
      - When forwarding `AgentResult.warnings` to `fanout("harness",
        ...)`, also attach them to the per-iteration telemetry record
        via the new `warnings` field.
      - Skip the summary entirely if no iterations ever ran (i.e.
        `state.iteration === 1` and no telemetry record was written).
        Detect this with a flag flipped on the first `writeTelemetry`
        call.
- [ ] Add `test/run-summary.test.ts` covering:
      - Single-agent happy path with all fields populated.
      - Multi-agent run with mixed `cost_source` values; notes block
        lists the mix correctly.
      - Run with one `unavailable` iteration; notes block names the
        agent and count.
      - Run where one iteration's `cost_usd` is null; total row shows
        sum of known plus a notes entry.
      - Run where every cache column is 0; cache columns omitted.
      - Filtering by `startTs` excludes records from an earlier run
        with the same namespace.
- [ ] Add `test/run-cost-summary-integration.test.ts` (or extend an
      existing run-loop test) that runs the harness against a stubbed
      agent producing known `usage`, then asserts the printed summary
      includes the expected totals.

## Acceptance criteria

- [x] At end of `jarvis run` (any exit reason except pre-iteration
      preflight failure), a summary block is printed to stdout with
      per-agent and total rows.
- [x] The summary's totals match the sum of telemetry records written
      during the run (verified by integration test).
- [x] Mixed sources, missing usage, and missing prices are surfaced in
      the `notes:` block rather than silently flattened.
- [x] Cache columns are omitted when not used.
- [x] No summary is printed when zero iterations ran.
- [x] `bun run typecheck` passes.
- [x] `bun test` passes (including the new tests).
- [x] `bun run check` passes.

## Documentation updates

- [ ] Add an `### End-of-run summary` subsection to
      `docs/run-loop.md` describing what the summary shows, where it
      comes from (telemetry JSONL), and the meaning of the `notes:`
      annotations.
- [ ] Cross-link from `docs/cost.md` (or equivalent) to the run-loop
      summary subsection.
