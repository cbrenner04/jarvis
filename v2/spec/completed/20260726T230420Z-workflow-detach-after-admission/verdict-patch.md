Verifying the implementation against the spec and advocate points before issuing the verdict.
## Verdict — required outcomes

1. **Remove unrelated work from the PR**  
   `v2/spec/seeds/review-roles-ignore-the-configured-idle-budget.md` is staged but outside this spec. It must not ship on this branch.

2. **Restore independent usage coverage in `workflow.test.ts`**  
   Uncommitted changes alias `IMPLEMENT_USAGE` / `INTENT_USAGE` / `PLAN_USAGE` to `../cli/usage.ts`, so parse-error expectations no longer independently pin that usage documents `--detach`. Either restore self-contained expected usage strings (as on the committed branch diff) or add explicit assertions that failure-path usage includes `--detach` without only re-importing the production constant. `cli.test.ts` help coverage does not replace regression tests that were meant to lock usage text on invalid workflow argv.

3. **Exercise intent `intent paths:` stderr under `--detach`**  
   Subspec 00 requires the same pre-run-ID stderr as attach on admitted detach. Implement detach satisfies that structurally, but no test drives an intent preset whose built steps hit the `intent-stage` landing branch. Add coverage (detach at minimum; attach parity is desirable) that asserts the `intent paths: …` stderr plus run ID stdout and no client `wait`.

4. **Strengthen the detach-continuation regression**  
   `makeDetachContinuationDaemonClient` sets `entryTerminal` in a microtask on **client `close`**, so “workflow reached entry terminal” is not independent of CLI exit and the AC’s “launching CLI has already exited `0`” is not demonstrated (the test calls `main` in-process). The fixture must advance terminal state on a path that does not equate to “client closed,” and the test must establish ordering: CLI finished with exit `0` (subprocess is the straightest match to the AC) before entry terminal is observed.

5. **Fix attached-workflow child script hygiene**  
   The subprocess helper writes a fixed `.scratch/workflow-attached-cli-child.ts` and does not remove it. Match repo precedent: unique path per run (timestamp/random or `mkdtemp`) and cleanup in `finally` (or inline spawn without a persistent fixed filename).

6. **Correct stale preset wording in `write-behavior.md`**  
   The updated `jarvis run workflow` table row still says only `implement` is registered. That line is wrong on `main` and was touched in this change; align it with registered presets (`intent`, `plan`, `implement`, aliases) without expanding scope beyond that row.

7. **Rename the attached wait fixture identifiers (quality)**  
   `ATTACHED_MULTI_ROW_*` implies multi-constituent staging; the fixture only holds the **entry** `wait` until release (constituent branch exists for retarget mutation). Rename so names reflect entry-wait / held-rollup semantics, not multi-row daemon simulation.

**No action required (for actuator)**  
Core `--detach` parsing, shared-path strip, post-admission branch, preset/alias acceptance, failed-admission with `--detach`, guard-inversion integration tests, attached entry-terminal subprocess test with deterministic mid-state hook, and the three doc files named in the subspecs are in line with the spec. Daemon-side run lifetime after client exit remains out of scope (CLI-only). Positional stripping of a `--detach` token is an accepted single-operator edge case unless you choose to document it elsewhere. Test-only hooks (`setInvert*ForTest`, `setAttachWaitRunIdOverrideForTest`) match existing repo mutation patterns.