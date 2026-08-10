## Verdict — changes required

**1. The absent-timestamp regression does not exercise the stage path (AC 4 unsatisfied).**
`absent absolute timestamps paint no detail row` selects the *pipeline* node, so `stageDetailRows` never runs during that test. Its three assertions that no line starts with `startedAt:`/`endedAt:`/`decidedAt:` are vacuously true and would still pass if the stage timestamp rows were deleted entirely. AC 4 requires a monitor-lines case "with null stage boundaries."
**Required outcome:** a monitor-lines test must select a stage node whose `startedAt`/`endedAt`/`decidedAt` are null and assert those rows are absent, such that the case would fail if the stage detail seam stopped omitting absent values. Keep the existing pipeline-level absence assertions.

**2. Detail-row ordering changed without authorization.**
Appending the absolute rows moved operator-visible fields: pipeline `createdAt`/`finishedAtMs` now sit below `terminalAction`/`seedPath` instead of directly under `wallClock`; `terminalPublicationSucceededAt` is now separated from `terminalPublicationFailure`; run `createdAt`/`finishedAtMs` moved from near the top to after `prUrl`. The spec authorizes a *value-format* change only — nothing in the ledger, ACs, or doc updates covers layout. The fixture pins were reordered to encode the regression rather than catch it.
**Required outcome:** every affected detail section paints its fields in the same order as before this change, with only the values reformatted; the fixture pins revert to their original ordering (values updated to ISO form). The one-seam constraint is preserved by splicing the absolute rows at their original positions, not by appending.

**3. The `decidedAt` row is pinned only against the formatter, never against a literal.**
Composing expectations from `formatAbsoluteTimestamp(...)` is acceptable for the seam-routing pins, but the new `decidedAt` case has no literal ISO string anywhere, so nothing pins the row's actual rendered shape.
**Required outcome:** the `decidedAt` case asserts a literal `YYYY-MM-DDTHH:MM:SSZ` value.

**4. Import convention deviation.**
`tui-timestamp-format.test.ts` imports `./tui-timestamp-format` without the `.ts` extension; every other same-directory import in `v2/src/tui/` carries it.
**Required outcome:** match the surrounding convention.

**5. The mutation-anchor wrapper is undocumented.**
The seam contains a `{ value: … }.value` construction that exists solely to make the spec-mandated `@mutate` anchor text appear verbatim; `detailRows` takes tuples so the fragment cannot occur naturally. The formatter's equivalent constraint carries an explanatory comment; this one does not, so a future simplification would silently unparse the directive.
**Required outcome:** the wrapper carries a short comment naming it as the mutation anchor. Do not remove the wrapper.

**No action needed:** the `Number.isFinite` guard (deliberate, and the out-of-range branch still needs the second check), the duplicate `@mutate` directive in the formatter test (redundant, not wrong), and the fractional-second regex / pre-1970 flooring (no in-scope field carries a negative epoch).