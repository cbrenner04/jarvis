Verifying the advocate's upheld findings against the code and docs before issuing the verdict.
## Adjudicator verdict — required outcomes

1. **No production snapshot-binding replay on profile load failure**  
   `resolveWriteLoopAgentModelConfig` must not return `bindingResolution.agentModelConfig` when machine-profile resolution fails (including the current `missing required 'machineProfile'` string match). Continuation and admission must fail closed the same way fresh write-step admission would, consistent with the subspec (“no intentional replay exceptions”). Tests that relied on inline `agentModelConfig` without a real profile must use an explicit test seam (e.g. extend the existing `writeLoopBindingSourceDeps` hook), not a silent production fallback.

2. **Align operator docs outside the doc AC grep list**  
   Prose that still says resume, queue promotion, or daemon start **rebuild bindings from persisted** `agentModelConfig` must be updated to match the new behavior (current machine profile at continuation; persisted snapshot config is historical). At minimum: `v2/docs/agent-model-config.md` (Relationships / workflow write persistence, ~130–135) and `v2/docs/daemon-host.md` (queued workflow promotion, ~661–663). The subspec doc AC passed on four files; these gaps still imply snapshot JSON is binding truth on continuation.

3. **Guard test must discover all `resolveWriteLoopBindings` call sites**  
   The static allowlist AC is only load-bearing if new callers under `v2/src` (non-test) cannot appear without failing the guard. Scan production sources repo-wide (not a fixed trio of paths), compare to the allowlist (`daemon.ts`, `cli.ts` unless audit finds more), and keep the invertible `forceSnapshotAgentModelConfig` behavior test.

4. **Rename the workflow-start regression so the title matches what it exercises**  
   The test named like “second workflow admission on a live daemon…” drives handler write-loop start (`startRunDirect` / `handleWriteLoopStart`), not `handleWorkflowStart` → `executeWorkflow`. Rename (or equivalent) so it describes **second write-loop admission on a live handler after a profile rung edit**, avoiding false intent AC2 (“workflow admission”) coverage. No requirement to add a full workflow-start integration test in this subspec; fresh workflow steps already load the profile at CLI admission.

**Rationale:** (1) contradicts the spec’s “alignment only, no replay exceptions” and weakens AC3’s guard story if inversion still leaves a hidden replay path. (2) satisfies documentation tasks and operator-runbook intent without expanding scope beyond binding-on-continuation semantics. (3) matches the subspec’s audit/guard contract. (4) keeps acceptance honest without blocking merge of the core fix.

**No other actuator work required** for merge on this review pass: core choke-point behavior, named regression tests, forbidden-phrasing AC on the four listed docs, shrink role mapping, queue promotion, and review-phase `retry_later` scope are adequately addressed or correctly out of scope.