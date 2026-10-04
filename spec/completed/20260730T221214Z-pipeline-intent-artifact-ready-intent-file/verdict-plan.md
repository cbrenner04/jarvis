# Verdict: Required refinements

## Upheld issues

The spec correctly targets the directory-vs-file `specPath` mismatch and resume `durableDir` derivation, but it is incomplete for the dominant production path and for proving the stated intent→plan failure is fixed. Several advocate concessions are binding: review-last landing, persistence, pipeline-resolution proof, idempotent re-land, documentation, and prerequisites must be addressed before merge.

---

## Required refinements

1. **Review-last intent completion path**  
   The spec must explicitly require that when intent landing runs through the review-last / `intent-reviewed` completion path (not only zero-review or direct landing), the landed file handoff `specPath` is captured and recorded on the entry/write run row. Without this, an implementation can satisfy `landIntentWorkflowOutput` unit tests while the default pipeline path still stores the durable directory.

2. **Post-landing persistence on the entry run**  
   The spec must state as an outcome that after intent landing completes, the step-0 entry/write run row’s `specPath` is updated to the handoff value (file or directory per single/multi-file rules), and that `pipeline-stage-dispatch` reads this persisted value unchanged. The task list must name this persistence seam; “persist after landing” alone is insufficient without specifying which run row is authoritative.

3. **Pipeline-resolution acceptance criterion**  
   Add at least one AC that directly pins the reported bug: after single-file intent completion, the stage artifact’s `specPath` names a file and plan-stage resolution accepts it (e.g. `validateReadyIntent` passes, or `resolvePlanStage` / equivalent succeeds). Layered landing + run-row tests alone do not prove intent→plan handoff works.

4. **Review-last integration test**  
   `workflow-runner.test.ts` coverage must exercise review-last intent completion (not only `reviewPasses: 0` or isolated landing), asserting the entry run records the file path and failing on baseline directory recording and inverted single-file guard.

5. **Idempotent re-land**  
   Extend decisions and ACs so the single-file → file path / multi-file → directory rule applies to the idempotent re-land early-return path in `landIntentWorkflowOutput`, with a named failing-test AC in `intent-output.test.ts`.

6. **Landing count semantics**  
   Clarify in decisions that “exactly one landed file” means markdown files produced by **this** landing invocation, not total files already present under the durable ready-intents directory.

7. **Resume finalization consumers**  
   Beyond `durableDir` derivation in `resolveIntentFinalizationResumeContext`, the spec must require that `landing.output.durableDir` and commit/publish scope remain the configured durable directory when the stored `specPath` is file-shaped. Include a failing-test AC (or extend the existing resume AC) that inverts the file-vs-directory guard for these outcomes.

8. **Handoff authority and path shape**  
   Clarify that pipeline handoff authority is the write/entry run row (`stepId: "intent"`, step 0), and that handoff paths remain project-root-relative as today’s durable-dir paths are. Plan resolution `cwd` behavior is unchanged.

9. **Documentation updates**  
   Replace “None” with required doc tasks. At minimum, correct `v2/docs/workflow-runner.md` where it states intent publication receives the durable directory as `specPath`. Per spec guidance for behavior changes, update `v2/docs/v1-behaviors.md` to record the new handoff semantics. Narrow any deferral to operator-runbook/daemon-resolve prose only—do not defer the incorrect workflow-runner claim.

10. **Prerequisites on the subspec**  
    Copy or reference the intent’s prerequisites (`pipeline-stage-dispatch` artifact recording; `landIntentWorkflowOutput` git-enabled landing) into the subspec so implement agents re-validate dependencies at run time.

11. **Named test surface for publication landing**  
    Add `publication-landing.test.ts` to the task checklist or ACs as a surface that must be updated for the new single-file `specPath` shape.

12. **Expected publication metadata change**  
    Record in decisions that when handoff `specPath` becomes a file, publication title/commit `Spec:` metadata may use the file basename rather than the durable directory—an intentional behavior change, not an implementation surprise.

---

## Not required

- **Subspec split:** One subspec remains acceptable if refinements 1–12 are incorporated; the work is one causal chain (land → persist → dispatch → plan resolve). Split only if review-last and persistence cannot be made independently testable within one subspec.
- **Git-disabled intent scope:** Optional clarification; not blocking.
- **Zero-file landing:** Out of scope; validation fails before landing returns.
- **Dropping generic `typecheck` / `test:v2` AC:** Minor; named failing-test ACs satisfy spec guidance.

---

## Rationale

The intent’s observable outcome is pipeline plan receiving a concrete ready-intent **file** path. The dominant `review: "light"` path bypasses the landing block the spec currently emphasizes; without explicit review-last tasks and persistence, the spec can be “done” while production pipelines still fail at `validateReadyIntent`. Spec guidance requires failing-test ACs for new runtime behavior, behavior-change documentation (`v1-behaviors.md`), and prerequisites on implementable subspecs—the draft violates or omits these. Pipeline-resolution and review-last ACs close the gap between unit-level landing changes and the stated bug.