- Define one resumability contract for positive and negative cases across resume admission, `list`, `wait`, and newly emitted `loop_finished` records. Clarify how immutable historical records are represented when current reconstruction rejects admission.

- Specify deterministic, invocation-scoped write-sibling selection and fail closed on incomplete, conflicting, or ambiguous candidates. A completed linked write row may supply reconstruction context even when that same row is the workflow entry ID and remains an invalid resume target.

- Name the actual durable persisted review-row shapes supported by this recovery. Do not conflate the non-durable light `implement-review` behavior with durable `review-debate` or landing-bearing review rows.

- Define authoritative sources and precedence for every reconstructed value needed by finalization—including base ref, spec path, worktree, completion attribution, and publication shape—and verify them with conflicting review-shaped fields.

- Cover recovery from pre-fix persisted state: close and reopen durable storage/log readers, then prove projection and resume work without requiring newly added persisted fields.

- Bound the shared resolver change. Mutation-tail resolution must not unintentionally alter populated-intent `landing_failed` recovery; preserve that behavior with an anchored test unless its change is explicitly included.

- Define the complete agent-free recovery lifecycle and repeat-resume outcomes, including committing surviving operator changes where required, mutation re-verification, ready gating, and publication. Enumerate admitted retryable outcomes and excluded terminal outcomes. Rejected admission must create no attempt and invoke no committer, finalizer, publisher, or agent.

- Expand regression coverage to include daemon-level resume, `list`, and `wait`; both positive and negative projection/admission agreement; reopened durable state; linked-row and entry-row dual roles; and rejection before side effects. Retain the named baseline-failing workflow regression and guard-inversion coverage required for runtime changes.
