- Split the oversized subspec into independently testable worktree/write-loop, workflow-review, intent-output, attribution/completion-rendering, and IPC-responsiveness slices. Link all replacements from `index.md`; each original task and acceptance outcome must appear exactly once.

- Cover every daemon-reachable run-path Git helper, including review-enforcement status/checkout/clean calls and worktree setup—not only the initially named paths. State that completion commits are in scope; push, PR publication, and ready finalization are not.

- Anchor behavior-preservation criteria to the existing tests covering each converted boundary. Keep the new IPC-responsiveness outcome as a new-behavior criterion.

- Define a deterministic responsiveness proof: a representative run-path Git operation reaches a signaled pending state, then an unrelated RPC completes before Git is released. This proves event-loop yielding rather than a race.

- Require preservation of relevant async subprocess contracts: output encoding/buffering/trimming, stdio, failure handling, fallback behavior, and sequential cleanup/order.

- Explicitly retain the current no-cancellation behavior for in-flight Git, unless committed daemon abort/shutdown semantics demonstrate no such boundary exists; avoid inventing cancellation policy.

- Update `v2/docs/v2-architecture.md` for the daemon run-path yielding guarantee and `v2/docs/v1-behaviors.md` for this existing-behavior change.
