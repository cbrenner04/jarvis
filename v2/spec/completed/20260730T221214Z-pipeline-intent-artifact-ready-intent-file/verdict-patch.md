Reviewing implementation and docs against the spec to issue an independent verdict.
## Verdict

### Required outcomes

1. **Fix stale `landReviewedPublicationOutput` contract comment**  
   The JSDoc still describes the old return shape (`undefined` on success / error string on failure). It must describe the current `{ ok: true, specPath } | { ok: false, message }` result so the shared review-landing entry point’s contract is accurate at the only durable home for that behavior.

2. **Repair `workflow-runner.md` formatting at the intent landing paragraph**  
   The new handoff/pipeline paragraph runs into the following “landing failures…” sentence without a break. Restore readable paragraph separation so operator docs stay scannable and the handoff semantics are not buried in adjacent prose.

3. **Make integration invert-guard assertions match the subspec ACs**  
   The subspec requires review-last and resume tests to fail when the relevant guards are inverted, not only on baseline directory recording.
   - **Review-last AC:** the invert assertion must exercise single-file **handoff** logic (`intentHandoffSpecPath` with the landed filename from this invocation), not `configuredIntentDurableDir`. Today the happy path pins persistence; the invert line does not pin handoff guard regression as the AC states.
   - **Resume AC:** the invert assertion must prove `resolveIntentFinalizationResumeContext` depends on the file-vs-directory guard (e.g. resolved `durableDir` / `landing.output.durableDir` match the non-inverted helper for the stored write-run `specPath`, and would not match an inverted guard). A standalone inverted-helper check does not satisfy “inverting the file-vs-directory guard makes the test fail” for the resume resolution path.

   **Rationale:** Spec failing-test ACs are explicit; `intent-output.test.ts` already follows this pattern correctly. Integration ACs should too, or they give false confidence that the guards are pinned on the production paths this slice fixes.

### Not required for this slice

- **End-to-end `dispatchPipelineStage` test:** Subspec AC allows `validateReadyIntent` or plan-stage resolution; dispatch is a documented prerequisite and already copies `entryRun.specPath` unchanged. The new persistence + plan-resolution test closes the reported bug.
- **`runProfileReviewStep` handoff persistence:** Durable intent review routes through the standard review landing path with `persistHandoff`; profile review is non-durable and not used for pipeline intent today.
- **Resume commit `specPath` parity with happy-path file handoff:** Spec decision #12 covers happy-path publication metadata only; resume recovery using directory-scoped commit metadata does not block plan resolution, which reads the persisted entry-run handoff path this slice fixes.
- **`stat`-based file detection in `configuredIntentDurableDir`:** Aligns with “when the stored path names a file” and matches `validateReadyIntent`; acceptable given resume preconditions (populated stage, landed file exists).
- **Debate-path, nested `ready-intents`, store-level `setRunSpecPath`, or dispatch integration tests:** Not required by the subspec; same landing seam or pre-existing coverage.

### Rationale

The implementation satisfies the subspec’s functional intent: single-file landing records a file-shaped handoff, review-last persistence updates the step-0 entry run, resume derives the configured durable directory correctly, plan validation accepts the file path, and docs record the new semantics. Remaining work is spec-AC test fidelity (invert guards on integration paths) and two small documentation hygiene fixes that should land with the patch.