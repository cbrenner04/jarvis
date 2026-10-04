# Adjudicator Verdict

Required refinements before merge:

## 1. Correct the terminal durable status vector

Replace `succeeded×5` after `ready` settlement with the vector that matches approval-stage semantics: `succeeded, approved, succeeded, approved, succeeded`. Also pin post-settlement pipeline-level outcomes: `terminalPublicationSucceededAt` set and `derivePipelineState(...) === "succeeded"`. Apply in both `intent.md` and the subspec Decisions/AC text.

**Rationale:** Mid-run vectors already use `approved` on gates; terminal `succeeded×5` contradicts `isAuthoredStageSatisfied` and would force a failing test or a wrong production change.

## 2. Add a settlement-interval boundary

Between “implement dispatches” and the final terminal snapshot, pin durable state while terminal publication is in flight: workflow stages `succeeded`, gates `approved`, pipeline derived state `running`, then the corrected terminal stage vector after publication completes.

**Rationale:** Existing settlement tests prove this interval exists; omitting it leaves a gap in the pinned progression the spec claims to enforce.

## 3. Make handler-path terminal faking an explicit spec outcome

State that the integration case must exercise `pipeline_start` / `pipeline_approve` / `pipeline_resume` handler admission—not out-of-band `runPipeline`—and that handler deps must allow faking `executeTerminalPublication` (or an equivalent seam) so `ready` settles without live `gh`.

**Rationale:** Intent requires daemon dispatch with agent invocation faked only at the boundary; current handler wiring does not compose with that goal without a named production seam.

## 4. Pin faking boundary, fixtures, and `resolveStage` realism

Clarify that admission uses real `resolveProjectPipeline` (not hand-built definitions) and that stage resolution follows the production handler `resolveStage` path. Name fixture requirements the case needs (e.g. `sandbox-git-repo`, registered project config with `projects.<name>.pipeline`, artifact/seed files). Limit faking to agent invocation (`dispatch` / `wait` / write-loop) and terminal publication—not daemon dispatch or definition validation.

**Rationale:** Without this, implementers may stub resolution or bypass the composed path the intent rules out.

## 5. State daemon test topology

One decision sentence: use in-process `createRunControlHandlers` (same as existing daemon pipeline tests); `.sandbox-unrunnable` is for git/fixture/load partition, not socket transport.

**Rationale:** “Through the daemon” is ambiguous; the repo’s peer proofs do not require a spawned daemon process.

## 6. Pin how `plan` fails once

Name the failure injection point (e.g. first `plan` dispatch: `wait` returns failed, or controllable write-loop abort) consistent with the pinned `failed, skipped, skipped` vector.

**Rationale:** Pinned vectors constrain outcome but not mechanism; naming the seam reduces implementer divergence.

## 7. Mandate boundary observation discipline

Require `waitFor` / `loadPipeline` polling after async handler returns (especially post-`pipeline_resume`). Optionally add the pre-dispatch resume vector (`succeeded, approved, pending, pending, pending`) before `plan` returns to `running`.

**Rationale:** AC2’s “reset of skipped later stages on resume” is logically required but not fully pinned; immediate reads can race background continuation.

## 8. Narrow AC3 to a verifiable regression mechanism

AC3 must require the composed case to turn RED when `intent`, `plan`, or `implement` is not dispatched or when resume redispatches completed `intent`. Specify mechanism: e2e dispatch-count assertions plus inversion of an existing resume guard (e.g. `resumeFailedRequiresReopen`)—not mandatory new production exports unless test-local observation cannot faithfully detect redispatch.

**Rationale:** Intent AC3 is behavioral; mandatory new exports conflicts with the single-surface claim unless acknowledged as a second touched module.

## 9. Resolve single-surface claim vs touched modules

Either narrow Decisions so dispatch/regression guards are test-local only, or explicitly acknowledge `pipeline-execution.ts` and/or handler deps as in-scope surfaces alongside the integration test and docs.

**Rationale:** Intent declares one harness surface; invert-hook and terminal-publication plumbing may touch execution/handler code.

## 10. Replace AC4 with the intent-aligned behavioral criterion

Change AC4 from naming `scripts/test-slice.ts` to: `bun run test:integration:v2` exits zero. Keep `.sandbox-unrunnable.test.ts` filename convention in Decisions if useful—not as a graded one-file AC.

**Rationale:** Enrollment is filename-derived; naming `test-slice.ts` violates one-file-per-bullet and grades structure instead of behavior.

## 11. Sharpen doc acceptance outcomes

- **Walkthrough:** Require a clearly labeled section (e.g. configured pipeline via `jarvis pipeline start`) with prerequisites (`projects.<name>.pipeline`, registration) and when to use pipeline vs direct `run start`.
- **Runbook:** AC6 must name a concrete delta—a Status or Prerequisites statement that configured pipelines are supported for registered projects—plus link to the walkthrough section, not link-only.

**Rationale:** Doc ACs must be verifiable; current runbook already documents commands; “marks usable” lacks a concrete artifact.

---

**Not required:** Split the subspec. Intent explicitly waives splitting for one composed integration harness surface; tasks and ACs are coupled to a single observable outcome.

**Holds without refinement:** Problem statement, `full-review` + `ready` fixture, fail-once-resume shape, mid-run pinned vectors (aside from terminal/settlement gaps), failing-test-first AC1, prerequisite anchors, doc ownership split.