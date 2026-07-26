## Verdict — refinements required

**1. Fix the factual error in 00's Problem statement.**
`runV2TestFiles` covers only the *agent* half of the roster; integration files are spawned by `runBunTest` in `scripts/run-tests.ts` (also `stdio: "inherit"`, but with no per-file timeout). The Problem currently claims `runV2TestFiles` spawns the whole aggregate roster. A spec's Problem section is the reviewer's baseline; a wrong baseline invites the implementer to instrument or reason about the wrong code path. Restate accurately (both paths, and that only the agent path carries a per-file timeout).

**2. Name the residual honestly, and define it.**
`wallClockMs - inFileMs` is not "spawn overhead" — it is process spawn *plus* module resolution, transpile, import side effects, and teardown. The measurement is the right one (it is exactly the cost a shared-process runner would eliminate), but the label prejudges the runner decision that this spec exists to inform, and subspec 01 writes that label into a doc that will be read as a verdict. Both subspecs and the recorded doc section must use a neutral term for the residual and state in one sentence what it contains.

**3. Decide where the reporter test lives so a roster actually runs it.**
Nothing in `aggregateTestFiles()` walks `scripts/`, so a test at `scripts/measure-test-cost.test.ts` is never executed by `bun run test` or by CI scope selection. This is a pre-existing repo condition rather than a defect this spec creates, but 00 leans on that test as its failing-test surface, which is inert if nothing runs it. The spec must either place the test where a roster walks it or carry an explicit decision naming how it gets run. Extending `aggregateTestFiles()` to walk `scripts/` is *not* the default answer — it contradicts the intent's decision that measuring must not change what the aggregate runs.

**4. Bound the measurement.**
The command has no timeout decision at all. One hung file hangs a ~12-minute command with no signal, and the existing runner already has a per-file timeout on its agent path that the measurement would not inherit. Add a decision covering per-file bounding and how a timed-out file is reported (it must not silently become an unparsed or zero-execution row).

**5. Harden the summary-line parse.**
Enumerating exactly the `ms` and `s` duration forms and assuming stderr-only bakes in assumptions that the largest single contributor (`v1/test/run.test.ts`, ~120 s) is the most likely file to violate. Decide for generic duration-token parsing and capturing both output streams. State explicitly that the positional file-argument path is the cheap real-output smoke check — that hedge exists in the design but is never claimed as one, and it is what makes the pure-function/fixture testing decision safe.

**6. Make 01's acceptance criteria falsifiable.**
- "consistent with the recorded measurement" is untickable in either direction. The existing 697 s figure came from a hand-run `time` over the runner path and `test:cost` will not reproduce it; the spec must state the fate of 697 s explicitly (replaced, or retained as the runner-path figure alongside the measured one) so an implementer can tick or fail the criterion.
- "the highest-overhead files" needs a number (e.g. top 5).
- Unparsed files must be *named* in the doc, not only counted — a bare count gives a reader no way to judge what was excluded.

**7. Bind the recorded figures to evidence.**
As written, nothing distinguishes a genuine measured run from plausible invented numbers — a known failure mode for docs-figure subspecs. Require the reporter's raw output to be committed as an artifact the recorded totals are derived from, and require stable per-file ordering in that output so two runs are diffable.

**8. Record the measurement's own caveats and cost.**
Two items belong in the doc section, not left implicit: (a) the measurement pipes output where the real runner inherits it, and does not fail-fast, so its totals are not identical to a `bun run test` transcript; (b) the run takes ~12 minutes against a 15-minute `TEST_STEP_BUDGET_MS` in an implement iteration that must also run its own gate — the spec needs a decision on how 01 obtains the numbers without blowing that budget. Add the staleness instruction ("re-run when the roster changes materially"), matching the drift instruction already present in the budget prose.

**No split required.** 00 is one implementation path; 01 is genuinely docs-only over 00's output. Both are independently verifiable as scoped.