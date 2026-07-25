Verifying key claims in the codebase before issuing the verdict.
## Verdict — required outcomes

1. **Align `workflow-runner.md` overrun text with the new bound**  
   The section around lines 546–547 still says `roleTimeoutMs` defaults to the write-loop iteration timeout. That contradicts the new prepare-time resolution (`reviewRoleTimeoutMs`, default 1,800,000 ms) and the paragraph added earlier in the same doc. Operator-facing docs must be internally consistent and match behavior.

2. **Cover `review-debate` in workflow stamping tests**  
   Acceptance criterion #1 requires the configured/default bound on both `review` and `review-debate` steps. `prepareWorkflowSteps` stamps both behaviors with the same logic, but tests only assert `behavior: "review"`. A regression that dropped the `review-debate` branch would stay green. Add coverage so the daemon payload includes `roleTimeoutMs` on a `review-debate` step (at least for the default and configured cases, mirroring the existing review tests).

3. **Clean up the uncommitted working tree before merge**  
   Local edits refactor timeout readers via `readPositiveNumberField` and fix a stale “write-loop wall clock” comment in `review-role-invocation.ts`. The branch diff summary does not include that refactor. Either land those changes on the branch (with tests still passing) or revert them so review/CI match what merges—no stray local-only diffs.

**Not required for merge (behavior already matches spec):** launch-wide validation of `reviewRoleTimeoutMs` without review steps; unconditional overwrite of preset `roleTimeoutMs` at prepare time (same pattern as write bounds); snapshot non-persistence for review steps given current resume restrictions; optional install-and-config table row, idle-constant import dedup, and spec prose tightening on “snapshot retention.”