# Surface numeric exit code in run summary

## Problem

The run summary prints `exit reason: <reason-word>` (`v1/src/run-summary.ts:472`,
`:511`) but never the numeric process exit code. The operator reads the numeric
code from the shell (`$?`) and must infer its meaning. The summary's reason word is
produced by `mapExitCodeToReason` (the switch in `v1/src/modes/patch/run.ts:327`,
called at `:313`/`:317`); its words differ from the iteration-level reason literals.
A code→meaning legend exists in `v1/docs/run-loop.md:716-731`, but it maps codes to
prose, not to the reason words the summary prints — so neither output is
self-describing on its own.

## Decisions

- Compose the summary's `exit reason:` value as `<reason-word> (exit code <n>)` at the
  `mapExitCodeToReason` call sites in `run.ts` (`:313`/`:317`), where both the numeric
  `exitCode` and the mapped reason word are in hand, rather than threading a new
  numeric field through `runSummary`/`renderSummaryFromRecords`. Rules out composing
  inside `finalize`, which receives only the reason string — not the code.
- Scope to the patch run summary only. Plan summary is out of scope: its exit-code set
  differs and the intent's doc target is `run-loop.md`. Rules out editing the shared
  `renderSummaryFromRecords`, which would change plan output too.
- The `run-loop.md` legend mirrors `mapExitCodeToReason` (the authoritative code→word
  table); each legend row gains the reason word that switch returns for the code. Rules
  out sourcing the words from `run-summary.ts`'s interpolation, which only relays the
  already-mapped string and is not the table of record.

## Task checklist

- [ ] Compose the patch summary's exit-reason value to include the numeric exit code at
      the `run.ts` `mapExitCodeToReason` call sites.
- [ ] Add each `mapExitCodeToReason` reason word to its row in the `run-loop.md`
      exit-code legend.
- [ ] Record the new summary output shape in `v2/docs/v1-behaviors.md`.

## Acceptance criteria

- [ ] The `jarvis run` summary's `exit reason:` line includes the numeric process exit
      code alongside the reason word (e.g. `exit reason: quota-exhausted (exit code 2)`),
      on both the telemetry and no-telemetry summary branches.
- [ ] The `v1/docs/run-loop.md` exit-code legend maps each code to the reason word
      `mapExitCodeToReason` returns for it.
- [ ] A `run-summary` test asserts the composed `<reason-word> (exit code <n>)` shape on
      the no-telemetry branch (`runSummary` with no telemetry records).
- [ ] Existing `run-summary` tests stay green except where they assert the old
      `exit reason:` line, which is updated to the new shape.
- [ ] The plan summary's `exit reason:` line is unchanged (no numeric code added).

## Documentation updates

- `v1/docs/run-loop.md` — add reason words to the exit-code legend.
- `v2/docs/v1-behaviors.md` — record the run summary's new `exit reason:` shape.
