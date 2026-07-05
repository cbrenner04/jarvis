Confirms scope creep on the v1 spec files — an unrelated in-flight spec (`mock-real-subprocess-tests`) got sequencing notes bundled into this branch. That's out of scope per AGENTS.md. Now I have enough to issue the verdict.

## Verdict

**1. Remove out-of-scope edits.** `v1/spec/2026-07-05T05-26-04Z-mock-real-subprocess-tests/07-v1-patch-review-tests.md` and its `intent.md` belong to an unrelated, already in-flight spec (PR #1031 rebase sequencing) and have no relationship to `review-debate-behavior`. Revert these two files to their pre-branch state. Per AGENTS.md, changes must stay within the active subspec's scope; bundling an unrelated spec's edits into this branch is not authorized here regardless of how correct the content is.

**2. Keep the `v2/src/cli.test.ts` fix.** The `machineConfigPath: absentMachineConfigPath()` additions are a minimal, in-scope test-hygiene fix (prevents two tests from leaking the operator's real `~/.jarvis/config.json`) and should remain.

**3. Simplify the adjudicator failure check for consistency.** In `review-debate.ts`, the adjudicator branch (`adjudicatorFailure !== null || adjudicator.final === null || adjudicator.final.result.kind !== "ok"`, with `adjudicatorFailure ?? "no_binding"` as the failure-kind fallback) has two disjuncts and a fallback that `failureKind()` already makes unreachable. Reduce this to the same `if (xFailure !== null)` shape used for the adversary, advocate, and actuator checks so the four role-failure guards read uniformly and don't carry dead branches implying a case `failureKind()` doesn't actually produce.

No other findings require action: the doc already states that a role failure stops the whole run (not just the current cycle), the `iterationsConsumed` field naming is covered by subspec 01's explicit multi-step-composition deferral, and no false claims were found in the 00/01 spec bodies (only checkbox ticks changed there).