## Verdict — refinements required

**1. Stop the doc from stating a conclusion the spec forbade.**
`v2/docs/test-writing.md` currently asserts "the cost is overwhelmingly in-file test execution, not process/spawn overhead." Subspec 00 decides explicitly that this spec *measures* the residual and **does not** conclude what fraction a shared-process runner would eliminate — and the same doc section disclaims that conclusion ten lines earlier. Remove the verdict sentence. What must be true: the section reports the measured split and nothing about what a runner change would buy.

**2. Reconcile — or explicitly flag — the contradiction with the intent's premise.**
The intent's motivating datapoint (v2 slice: 84 s wall vs 11.7 s reported test time, "~86% is spawn") disagrees with this measurement (0.2% residual) by orders of magnitude. Leaving both in the repo unreconciled makes the recorded figures misleading on exactly the decision they exist to inform. The doc must state that the two numbers are different quantities (bun's summary-line elapsed vs summed per-test durations) and that this measurement therefore does not settle the runner question.

**3. Correct the residual's stated definition.**
Both the reporter's doc comment and the doc section describe the residual as containing module resolution, transpile, and import side effects. The data refutes that: residual is a flat ~5–11 ms across a 2400× range of file cost (108.8 s file → 9 ms residual), i.e. bun's summary elapsed already includes load/import cost. Describe the residual as what it measurably is (process spawn plus runtime boot, plus teardown), so the doc doesn't overstate what a shared-process runner could reclaim.

**4. Excluded files must not inflate the residual total.**
Totals derive residual by subtracting summed in-file from summed wall clock, so a timed-out or unparsed file's *entire* wall clock becomes "residual" — one 180 s timeout would add 180 s of phantom residual. 00's acceptance criteria require such files to be excluded from the in-file **and residual** totals, and its rationale was precisely to avoid inflating the residual. Required: the residual total covers only successfully-parsed files; excluded wall clock is reported separately so nothing is silently lost. Add a totals-level test case covering an excluded file, since the current totals test does not pin this.

**5. Don't misreport an output-buffer overflow as a timeout.**
The measurement captures stdout+stderr under the default 1 MB buffer; on overflow the child is killed with the same signal/`status: null` shape the timeout predicate matches, so a chatty file would be labeled `timedOut`. Capturing output instead of inheriting it is this spec's own decision, so the exposure belongs here. Required: a buffer large enough for real test output, and overflow distinguishable from a genuine timeout.

**6. Fix the doc's factual errors and the ranking's honesty.**
- The baseline artifact has 229 file rows; the doc says 230.
- The doc points "below" to the 697 s figure, which appears above it.
- The top-5-by-residual list ranks files by differences smaller than bun's own reporting resolution (durations printed to 4 significant figures — ±10 ms of quantization at 108 s, which is also why one row shows `residual=-0ms`). 01 requires the list, so keep it, but it must carry the caveat that at these magnitudes the ranking is within measurement noise; otherwise the doc presents noise as signal.

**7. Land a coherent tree.**
The working tree carries uncommitted changes to `scripts/measure-test-cost.ts` and `test/measure-test-cost.test.ts` that were not in the reviewed diff, and one of them now walks the aggregate roster unconditionally — including on the file-argument path that 00 designates as the cheap smoke check. Ensure the final committed state matches what the gate verifies and that passing file arguments does not do roster work.

**Not upheld:** parser narrowness. Anchoring on the `Ran N tests across M files. [X]` line is stricter than a free-floating duration token by design and matches 00's stated `ms`/`s` units; an unanchored scan would risk matching durations printed by the test under measurement.