## Verdict — required refinements

1. **Record seed 02 supersession for this de-export slice.**  
   Add a decision that merging this spec completes seed 02’s de-export obligation for the eleven execution/workflow symbols listed here — not the rest of seed 02 (file deletes, `state-store-types` merge, resume rejection, duplicate-test removal).  
   **Why:** This spec is an intentional fan-out of that seed bullet. Without an explicit supersession pin, a later seed 02 run can re-touch the same lines as no-op or conflicting work.

2. **Pin de-export-only for in-file-used targets; drop the misleading delete branch for `WRITE_LOOP_OUTCOME_KINDS`.**  
   `WRITE_LOOP_OUTCOME_KINDS` is referenced in-file for `WriteLoopOutcomeKind` and runtime validation — deletion would break `write-loop.ts`. Either narrow that task to de-export only, or add a decision: symbols still used inside their defining module are de-export only, not deleted.  
   **Why:** The shared “(or delete if unused in-file)” template is wrong for at least this symbol and invites a broken implementation.

## No further required refinements

- **Prerequisites:** Subspec correctly omits seed 01; de-export work has no technical gate there.
- **Documentation:** `None` stands — visibility-only trim with no operator-facing or catalog obligation under `documentation-standard.md`.
- **Preset exempt / preserve ACs:** Enumerated trim list plus typecheck is sufficient; three-symbol preserve AC is adequate forward pin for seed 07.
- **Per-module `*.test.ts stays green` ACs:** Appropriate refactor anchors per spec guidance; typecheck covers cross-file export surface.
- **Single subspec spanning seven modules:** Acceptable — one atomic visibility trim with shared verification.
