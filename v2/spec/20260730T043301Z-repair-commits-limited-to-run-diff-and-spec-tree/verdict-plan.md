1. Require the repair fence to remain authoritative across process restart, completed-run retry, and resume. The spec must cover durable rejection provenance and the original frozen allowset so generic completion cannot later commit or publish the offending dirty path.

2. Cover review-mutation recovery separately from completed-run resume. Both production entry points must have focused regression tests proving a rejected path cannot be swept into a later commit.

3. Split the oversized subspec into independently testable slices for:

   - Ready-gate fence derivation, validation, and normal repair behavior.
   - Durable completed-run retry/resume.
   - Review-mutation recovery.

   Preserve every original task and acceptance outcome exactly once across the replacements, link every replacement from `index.md`, and keep documentation updates with the behavior they describe.

4. Define the candidate-path contract precisely enough to match what repair completion would stage. It must account for additions, deletions, type changes, tracked ignored changes, submodules, both rename sides, and unusual filenames while excluding files the completion commit would not stage. Require representative regression coverage, including NUL-safe path handling.

5. Define deterministic normalization and ordering for the intent’s “first offending path” guarantee. Without this, reported evidence can vary across environments and Git output order.

6. Require distinct positive tests for both allowset members: an existing run-diff path and a path within the resolved spec tree. Removing either membership rule must independently make its corresponding test fail, while existing bounded ready-gate repair coverage remains green.
