Verifying the spec layout and key code references so the verdict matches what's on disk.
## Verdict: refinements required

The intent and behavioral decisions are sound, but the draft is not runnable as an index-routed spec. Required outcomes:

### Routing and subspec shape

1. **Index must route all work.** Link `02-pipeline-stage-scoped-resume.md` from `index.md` after approval work, in dependency order. Without this, intent acceptance criteria for resume and resume documentation are unreachable.

2. **Collapse the approval split into one atomic subspec.** `00-persistence.md` and `01-daemon.md` duplicate problem, prerequisites, decisions, tasks, and tests; neither is independently implementable or testable. Replace them with a single daemon-boundary subspec that owns the full approval surface: execution entry points, RPC registration (`pipeline_approve` / `pipeline_reject`), tests, and documentation. Every approval task and acceptance outcome from both files must appear exactly once in the replacement, and the replacement must be index-linked.

3. **Correct module-boundary labeling.** The approval subspec is daemon execution and RPC work, not persistence. Title and framing must match the daemon surface; the store API is prerequisite-only.

4. **Fix broken cross-references.** `02` prerequisites link to a non-existent `00-pipeline-approval-decisions.md`; point at the merged approval subspec instead.

5. **Assign documentation updates.** The approval subspec must carry its `## Documentation updates` entries (currently empty in `00`). Resume docs stay on `02`.

### Approval subspec — acceptance and contracts

6. **Gate-blocking behavior.** An acceptance criterion must prove that when a pipeline reaches an approval gate, no later workflow stage dispatches until an explicit decision — including assertion that the gate row is `awaiting` (loop behavior, not re-proving store persistence).

7. **Approve, reject, and terminal derived state.** Criteria must cover: matching approve advances to the next authored stage; matching reject leaves later stages undispatched and yields terminal `rejected` derived pipeline state.

8. **RPC apply/refuse outcomes.** Caller-visible results must be acceptance-tested: successful apply vs refusal for wrong stage, non-approval target, non-awaiting row, and duplicate/racing decisions — with no mutation or dispatch on refusal. Propagate store refusal reasons (`status_not_awaiting`, `invalid_decision`, etc.) at the RPC layer.

9. **Restart-through-RPC.** After store close/reopen (including post-reconcile `interrupted` ownership), an awaiting pipeline stays awaiting until a matching decision; `pipeline_approve` then continues from persisted context without caller reconstruction — exercised through the RPC handler, not store-only calls.

10. **Handler-level coverage.** Acceptance criteria must cover param validation, `daemon_superseded` retirement (with guard-inversion), and return-before-async-continuation — either in dedicated handler tests or by explicit citation of extended handler test patterns.

11. **Failing-test and guard-inversion requirements.** Each runtime-behavior criterion must name a test in `pipeline-execution.test.ts` (or named handler tests) that fails on pre-fix baseline and passes after implementation; guard-inversion criteria must prove negative cases (duplicate decisions, refused decisions, inverted guards dispatch nothing).

### Resume subspec — mechanics and contracts

12. **Pin awaiting-resume mechanism.** Intent requires re-entering an awaiting gate without approving it and without dispatching later stages. The spec must state how this interacts with `isPipelineContinuable` (which excludes `awaiting-approval`) and startup activation invariants — i.e., an explicit resume path that does not weaken “do not auto-activate awaiting pipelines.” Acceptance criteria must prove: resume on awaiting preserves `awaiting`, dispatches no later stage, and does not depend on startup recovery treating the pipeline as continuable.

13. **Failed resume composition.** Pin when `reopenFailedPipeline` runs vs is skipped (e.g., only when reopen is required before activation). Criteria must prove re-dispatch of the failed stage only, with prior stage `workflowInvocationId` values unchanged.

14. **Terminal and reopen refusals.** Distinct named refusals for completed (`pipeline_terminal_succeeded`) and rejected (`pipeline_terminal_rejected`) pipelines, each without dispatch. At least one negative criterion for `reopenFailedPipeline` refusal on ineligible failed shape.

15. **Post-reconcile resume.** Symmetric to approval restart: resume on failed or awaiting pipelines after store reopen and ownership reconciliation must be acceptance-tested.

16. **Deferred states.** Either an explicit out-of-scope statement with a criterion that resume on `running` / `pending` / `interrupted` (non-terminal, non-failed, non-awaiting) is undefined and refused, or a pinned deferral that blocks implementer guesswork.

17. **Failing-test and guard-inversion for resume.** Same spec-guidance pattern as approval: named baseline-failing tests, guard-inversion for failed-only redispatch, awaiting-no-dispatch, and terminal refusals.

### Rationale

These refinements are required because: (a) index routing is the harness’s only work-selection mechanism — orphaned subspecs mean half the intent never runs; (b) spec guidance requires atomic, independently testable subspecs at module boundaries — the current approval split violates that; (c) runtime-behavior subspecs need failing-test ACs and guard-inversion for negative paths; (d) awaiting resume has a real tension with existing continuation invariants that the spec must resolve in decisions and ACs, not leave to implementers; (e) RPC contracts are the operator-facing surface — prose decisions without apply/refuse ACs are not verifiable.

**No redesign of intent is needed.** Refinement is structural (index, merge, cross-refs, labeling) plus contract and mechanism pinning for RPC outcomes, handler guards, and awaiting-resume behavior.