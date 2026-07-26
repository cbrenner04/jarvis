# 01 - Record measured aggregate cost

## Problem

`v2/docs/test-writing.md` records only the aggregate wall clock (697 s, 2026-07-26, from a
hand-run `time` over `bun run test`) used to size `TEST_STEP_BUDGET_MS`. It carries no split
between residual and in-file test execution, so the runner-change question ("is the cost residual
or tests?") is still answered by extrapolation from the v2 slice.

## Decisions

- Numbers come from one run of `bun run test:cost` over the full aggregate roster, not from a
  hand-run `time` — rules out an unreproducible transcript.
- That run's raw output is committed as `v2/docs/test-cost-baseline.txt` (stable per-file order,
  per 00's decision) — the artifact the recorded doc numbers are derived from, so a later run is
  diffable against it rather than trusted on the author's word.
- The 697 s figure is **retained**, not replaced: it is the `bun run test` runner-path wall clock
  (real invocation, inherited stdio, fail-fast), while `test:cost`'s totals are a separate,
  slower-and-more-lenient measurement pass (see caveat below). The doc keeps both figures, labeled
  by which command produced each.
- Record the three roster totals (wall clock, summed in-file execution, residual), the date, the
  hardware attribution ("operator hardware"), and the count of unparsed and timed-out files —
  rules out a bare percentage with no way to check it or to see what was excluded.
- Record the top 5 files by residual, by name — rules out a totals-only entry that cannot tell a
  reader whether the cost is uniform per-file residual or one outlier (`v1/test/run.test.ts`,
  ~120 s wall clock).
- Name every unparsed and every timed-out file individually, not just their counts — a bare count
  gives a reader no way to judge what was excluded from the in-file/residual totals.
- Caveat, recorded verbatim in the doc: `test:cost` captures each file's output instead of
  inheriting it, and does not stop on a non-zero exit or timeout, so its totals are not a
  `bun run test` transcript and will not exactly reproduce 697 s.
- The full-roster `test:cost` run (~12 minutes) is executed once, manually, before this subspec's
  own verification pass — not inside its `bun run ready` gate. This subspec touches only docs and
  the committed baseline artifact, so its own test-scope gate does not include running the full
  roster; the 12-minute measurement is a prerequisite input to the doc edit, not a step the gated
  iteration re-runs.
- Add a staleness instruction next to the recorded figures: re-run `bun run test:cost` and update
  both the baseline artifact and the doc numbers when the aggregate roster changes materially —
  matching the existing drift instruction on the budget prose.
- Docs-and-artifact-only subspec; no executable change — the reporter shipped in 00.

## Acceptance criteria

- [ ] `v2/docs/test-writing.md` records measured aggregate totals — wall clock, summed in-file
      execution time, and the residual between them — dated and attributed to operator hardware,
      naming every file whose in-file time was unparsed or timed out (not just a count).
- [ ] That section retains the 697 s `bun run test` runner-path wall clock alongside the new
      `test:cost` totals, labels which command produced each, and states the caveat that
      `test:cost` captures output and does not fail-fast, so its totals are not a `bun run test`
      transcript.
- [ ] That section names `bun run test:cost` as the command that reproduces the figures, lists the
      top 5 files by residual, and points to the committed `v2/docs/test-cost-baseline.txt` as the
      raw output the totals were derived from.
- [ ] The existing ready-gate budget prose in `v2/docs/test-writing.md` still cites the 697 s
      aggregate wall clock it sizes `TEST_STEP_BUDGET_MS` against, and a staleness instruction
      covers both that figure and the newly recorded `test:cost` totals.
- [ ] `bun run lint:md` passes.

## Documentation updates

- `v2/docs/test-writing.md` — measured aggregate cost split (residual vs. in-file execution),
  dated, with the re-run command and the caveat above.
- `v2/docs/test-cost-baseline.txt` — committed raw `bun run test:cost` output the doc figures are
  derived from.
