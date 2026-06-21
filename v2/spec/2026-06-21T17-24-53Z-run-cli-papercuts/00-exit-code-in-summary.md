# Surface numeric exit code in run summary

## Problem

The run summary prints `exit reason: <reason-word>` (`v1/src/run-summary.ts:472`,
plan equivalent `:512`) but never the numeric process exit code. The operator reads
the numeric code from the shell (`$?`) and must infer its meaning. The code→meaning
legend already exists in `v1/docs/run-loop.md:716-731`, but it maps codes to prose,
not to the reason words the summary prints — so neither output is self-describing on
its own.

## Decisions

- Surface the numeric code by composing the summary's `exit reason:` value as
  `<reason-word> (exit code <n>)` at the call site that already knows the code, rather
  than threading a new numeric field through `runSummary`/`renderSummaryFromRecords`.
  Rules out adding a parallel `exitCode` arg that the renderer would have to format —
  the caller (patch finalize) has both the code and the mapped reason in hand.
- Scope to the patch run summary only. Plan summary is out of scope: its exit-code set
  differs and the intent's doc target is `run-loop.md`. Rules out editing the shared
  renderer, which would change plan output too.
- Cross-reference in the doc: the existing `run-loop.md` legend table gains the reason
  word printed for each code, so a reader of either the summary or `$?` can map between
  them. Rules out leaving the legend code-only, which keeps the summary word
  un-cross-referenced.

## Task checklist

- [ ] Compose the patch summary's exit-reason value to include the numeric exit code.
- [ ] Add the reason word to each row of the `run-loop.md` exit-code legend.
- [ ] Record the new summary output shape in `v2/docs/v1-behaviors.md`.

## Acceptance criteria

- [ ] The `jarvis run` summary's `exit reason:` line includes the numeric process exit
      code alongside the reason word (e.g. `exit reason: quota-exhausted (exit code 2)`).
- [ ] The `v1/docs/run-loop.md` exit-code legend maps each code to the reason word the
      summary prints for it.
- [ ] Existing `run-summary` tests stay green except where they assert the old
      `exit reason:` line, which is updated to the new shape.
- [ ] The plan summary's `exit reason:` line is unchanged (no numeric code added).

## Documentation updates

- `v1/docs/run-loop.md` — add reason words to the exit-code legend.
- `v2/docs/v1-behaviors.md` — record the run summary's new `exit reason:` shape.
