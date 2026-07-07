Confirmed both findings in the actual code.

## Verdict

**1. Misleading "v2" label in timeout messages — must fix.**
`run-tests.ts` now calls `runV2TestFiles("agent", agent)` with a file list that includes v1, shared, and harness test files (`aggregateTestFiles`, `run-tests.ts:7-13`), not just v2 files. But `spawnTimeoutMessage` (`run-v2-tests.ts:18-21`) hardcodes the string `v2 "${mode}" test run timed out`. A timeout in a v1 or shared file will print a message falsely claiming it's a v2 run. This directly undermines the spec's stated goal of naming the actual culprit file accurately (acceptance criterion: "names that file in stderr"). Fix by removing the hardcoded "v2" from the shared message (or otherwise ensuring the message doesn't misattribute the source), without breaking `run-v2-tests.test.ts`'s existing expectations for the standalone v2 CLI entrypoint.

**2. Stale doc comment — must fix.**
`aggregateTestFiles`'s docstring at `run-tests.ts:6` still reads "agent tests parallel," but agent mode is now the serial per-file loop via `runV2TestFiles`. Update the comment to reflect actual behavior.

No other outcomes required — the parallel-to-serial tradeoff and the lack of a `run-tests.test.ts` are both accepted/pre-existing and out of scope for this subspec.