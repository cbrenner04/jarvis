Verdict: refine per findings 1 and 3; finding 2 is optional polish.

**Required refinements:**

1. **Fix the imprecise remediation for `cli.test.ts:766`.** The subspec currently implies this end-to-end test simply flips to a passing case once `--agent` is admitted, but the referenced call uses a nonexistent seed and will still exit 1 (now for seed resolution, not flag rejection). The subspec must specify the actual expected observable outcome: either (a) the test asserts the error message changes from `--agent is not supported` to the seed-resolution failure, or (b) the seed is made valid so the test exercises a genuine success path. Leaving this ambiguous risks the implementer writing a test that still fails, or asserting the wrong thing, and calling the AC done incorrectly.

2. **Name a concrete verification seam for the `agentOrder` override AC.** The spec asserts "no new parsing logic needed" because `intent.ts` already applies the override, but doesn't say how a CLI-level test can observe that the override reached `modes.plan.agentOrder` without invoking a real agent. This is a testability gap under the spec guidance's requirement that acceptance criteria be verifiable: either point to an existing test pattern (e.g., in `intent.test.ts`) that already asserts `agentOrder` overrides for the new CLI test to mirror, or narrow the AC to something observable at the CLI layer (e.g., "parses without error and reaches intent's existing override path") if no fully observable seam exists.

**Optional, not blocking:** clarify that the table-driven test at `cli.test.ts:293` should remove only the `intent` row, leaving the `config` regression row intact — this is already effectively guaranteed by AC3, so only tighten if it costs a single line.

No other changes to the core fix (adding `"intent"` to `AGENT_FLAG_SUBCOMMANDS`) are warranted.