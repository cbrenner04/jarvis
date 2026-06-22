# promptSummary builder + recordMatchesMode accepts prompt

## Problem

The shared summary surface in `v1/src/run-summary.ts` renders only `patch`
(`runSummary`) and `plan` (`planSummary`). `recordMatchesMode` matches `patch`
(everything not `plan`) or `plan` — there is no path that selects
`mode: "prompt"` rows, and no entry point that renders a prompt summary. This
subspec adds that rendering surface; the prompt-mode call site is wired in `01`.

## Decisions

- Add a `promptSummary` exported from `run-summary.ts` mirroring `planSummary`'s
  shape (single-attempt run). Rules out: reusing `runSummary` (it pairs
  `iterations` + `attempts`, both meaningless for a single-pass prompt).
- Extend `TelemetrySummaryMode` and `recordMatchesMode` to a three-way match so
  `"prompt"` selects only `mode === "prompt"` rows. Rules out: the current
  binary `!== "plan"` fallthrough, which would let `patch` summaries absorb
  prompt rows and vice versa.
- Prompt is single-pass: render no `iterations` line and no `phase attempts`
  line; use attempt-style labels (`rowCountNoun`/`noteUnitNoun` = `attempt`).
  Rules out: emitting patch-style `iterations:` for a mode with no iteration
  counter.
- Title line is `─── prompt summary ───`. Rules out a shared title that would
  make the three summaries indistinguishable in scrollback.
- The outcome line (no-diff vs PR-opened + URL) is rendered at the prompt-mode
  call site in `01`, not inside `run-summary.ts` (the builder has no diff/PR
  state). Deferred to first consumer: where the outcome line sits relative to
  the summary block — pin in `01`.

## Task checklist

- Add `"prompt"` to `TelemetrySummaryMode` and a three-way `recordMatchesMode`.
- Add `promptSummary(args)` with the no-telemetry fallback branch (matching
  `planSummary`'s early return) and a `renderSummaryFromRecords` call using
  attempt labels and no iteration/phase-attempt headers.
- Unit-test `promptSummary` and the extended `recordMatchesMode` in
  `v1/test/run-summary.test.ts`.

## Acceptance criteria

- [ ] `recordMatchesMode` with mode `"prompt"` matches a `mode: "prompt"` record
  and rejects `patch`/`plan` records; mode `"patch"` no longer matches a
  `mode: "prompt"` record.
- [ ] `promptSummary` renders a `─── prompt summary ───` block carrying the
  per-agent cost table (agent+model, tokens, cost, source), `duration:`, and
  `exit reason:` for a synthetic `mode: "prompt"` ok record with usage/cost.
- [ ] `promptSummary` emits neither an `iterations:` line nor a `phase attempts:`
  line.
- [ ] `promptSummary` returns the no-telemetry fallback block (the
  `(no telemetry records found for this run)` text) when `telemetryPath` is null
  or the file is absent.
- [ ] Existing `runSummary`/`planSummary` tests in `v1/test/run-summary.test.ts`
  stay green (rendering for patch/plan unchanged by the three-way match).

## Documentation updates

- `v2/docs/v1-behaviors.md`: record that `run-summary.ts` now renders a third
  mode (`promptSummary`) and that `recordMatchesMode` is a three-way match over
  `patch`/`plan`/`prompt` (changes existing summary behavior).
