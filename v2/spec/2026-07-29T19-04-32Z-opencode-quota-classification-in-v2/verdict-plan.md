Let me verify the key claims against the actual code before issuing a verdict.Key claims verified: opencode routes through `classifier: "cursor"` (not claude default); `isTransientSignal`/`isModelConfigurationSignal` discard `_name`; transient reachable only via non-zero exit; `finalizeOpencodeInvocationResult` no-ops on non-ok. The `guardedStatusPatterns` already uses a shared `transportContextWords` const, not the per-call context arg the spec describes.Confirmed. v1's `guardedStatusPatterns` already has the optional `contextWords` arg; the shared helper does not. The spec's "extend with optional context-words argument" is accurate for the shared side. All claims verified. Issuing verdict.

## Verdict

The spec is correctly scoped and atomic (one production file, one test file, two docs, single implementation path). The v1 field record backs every ported pattern. The following refinements are required before it is ready.

**Required refinements:**

1. **Correct the pre-fix baseline in the Problem section.** The current text says `quotaPatternsFor` "defaults to the claude quota table for anything unknown" and that opencode hits that default. This is false for opencode: the opencode binding sets `classifier: "cursor"`, so opencode currently routes through the **cursor** quota/transient/model-config tables, not the claude default. The claude-default clause describes only a hypothetical unknown agent opencode never reaches. Restate the baseline as: opencode gets the cursor tables, which miss opencode's phrasing, so quota settles `error`, the provider-config error is non-terminal, and the guarded 500 is not retried. This matters because the failing-test author must know the actual pre-fix classification to author fixtures that genuinely fail against baseline.

2. **Pin the non-zero-exit assumption for the guarded-500 transient path.** `isTransientSignal` is reachable only through the non-zero-exit settlement path; the zero-exit path checks quota only, and the opencode finalize step no-ops on non-ok results. Therefore AC3 (guarded 500 retried as transient) is satisfiable only if the fixture opencode invocation exits **non-zero**. A zero-exit 500 fixture would make AC3 silently unsatisfiable. The spec must record this constraint explicitly (verified against v1, which shares the `exitCode !== 0` guard) so the test author builds a non-zero-exit fixture. Do the same clarity check for the quota fixtures: both exit paths route through `quotaPatternsFor`, so quota is handled either way, but the fixture's exit code should still be stated.

3. **Name the signature-contract change on `isTransientSignal` and `isModelConfigurationSignal`.** Both functions currently discard their agent-name parameter (`_name`). Routing opencode patterns requires un-ignoring that parameter and threading the classifier through both — a change v1 already made. The Decisions/Tasks currently only imply this by saying "route them in"; state the `_name`-currently-discarded fact so the implementer knows both signatures must begin consuming `name`.

4. **Align the `guardedStatusPatterns` wording, and scope it to the shared helper.** The shared helper currently has no per-call context-words argument (it uses a fixed `transportContextWords` const); v1's helper already carries the optional `contextWords` parameter. So "extend the shared helper with an optional context-words argument" is accurate for the shared side and "port from v1" is accurate for the source — but the spec should make clear these describe the same bring-up of the shared helper to v1's existing signature, and that the added `unknownerror` context applies to opencode's 500 pattern only and must not widen 500 matching for other agents.

5. **Scope the `v2/docs/v1-behaviors.md` line-377 edit narrowly.** The doc task must edit only the quota/model-config/500 divergence clauses and leave any unrelated divergence content on that entry intact, to prevent accidental deletion.

**Minor tightening (do, low cost):**

6. **AC3 should assert re-spawn, not just classification.** Naming that the test asserts the bounded retry loop actually re-spawns (spawn call count ≥ 2) prevents a classification-only test that never proves the retry happens. The injectable `spawn` supports this.

7. **AC4 should name the exact opencode guards inverted** — the `name === "opencode"` branches added to quota routing, `isModelConfigurationSignal`, and `isTransientSignal` — so each inversion is unambiguous.

**No action required:** the two-distinct-`AgentName`-types observation (the file has exactly one local union; the widening target is unambiguous in context) and the quota zero/non-zero exit-path observation (self-resolving through the single `quotaPatternsFor` change) need no spec change. No split is warranted.