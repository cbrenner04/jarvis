1. Split the oversized subspec into independently testable ownership/admission and post-admission lifecycle subspecs. Link every replacement from `index.md`, and assign every original task and acceptance outcome exactly once.

2. Require the fan-out regression to exercise real stage resolution and workflow-start admission. It must prove predecessor artifacts are read-only inputs while sibling entry runs receive distinct destination ownership identities; neither destination may resolve to the predecessor worktree.

3. Make concurrency deterministic with an admission barrier: both siblings must reach the ownership/admission boundary before either is released or settles. “Same scheduling window” alone is not reproducible enough to guarantee a baseline-red regression.

4. Define the durable linkage identity precisely. Clarify that `workflowInvocationId` stores the entry-run ID and distinguish it from workflow-wide invocation metadata.

5. Strengthen the adoption invariant: after admission, the stage must remain linked, exactly `running`, and without `endedAt` until settlement. Coverage must include a post-admission error path, including the outcomes required for linkage-write failure and wait rejection, so an admitted live run cannot coexist with a failed stage.

6. Resolve the crash/restart adoption window. Because the intent promises durable linkage and adoption “once an entry run exists,” the spec must cover recovery/atomicity across that window or explicitly establish a narrower supported guarantee consistent with the intended invariant.

7. Reclassify pre-admission refusal coverage accurately. Either cite the existing focused refusal test as preservation coverage or require a durable-store assertion proving `failed` with null `startedAt` and `workflowInvocationId`, and no wait. Do not present mocked refusal handling as new real-admission coverage.

8. Validate the claimed destination-worktree retry/backoff behavior against an exact existing mechanism and test. If no such behavior exists, remove or correct the preservation claim or record the unconfirmed prerequisite as a blocker. Keep `multiple_failed_stages` preservation separately anchored to its existing test.

9. Retain mutation checkpoints on each real changed guard, with uniquely applicable `// @mutate` directives and named pinning tests that turn red independently. This is required by the executable-code spec guidance.
