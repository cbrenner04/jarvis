## Verdict: Required Refinements

**1. Revise must re-converge to `awaiting-human` (load-bearing).**
The intent describes a loop — revise produces new output, then the operator decides again — but subspec 02 spawns the revision step and never returns to a decision point. Spec must state: what triggers re-convergence (the revision write loop reaching a terminal outcome re-dispatches the same human step), and add an acceptance criterion proving a second `resume` decision is reachable after a revision completes. Without this, `revise` is a dead-end action, not a loop iteration, contradicting the intent's own description.

**2. Original run's status during an in-flight revision must be defined.**
This is entangled with #1: while the synthesized `${repeatStepId}~r<n>` write loop runs, the human step's original `awaiting-human` row needs a defined state (e.g., an interim status, or the synthesized run's own status stands in until it completes and the human step re-converges). Resolve this as one decision alongside #1, not as an afterthought — the state machine is incomplete without it.

**3. Human step's `worktree` field needs a stated purpose or should be dropped.**
Subspec 00 introduces `worktree` on the human-step shape, but subspec 02's dirty-check operates on the *repeated* step's worktree, not the human step's own. Either state what the human step's `worktree` is for (e.g., default revise target, display purpose) or remove it. An unused field on a new discriminated-union shape is unexplained surface area.

**4. Reconcile `onRevise.maxRevisions` against the intent's "configured range... N."**
The intent frames revision budget as consuming one of the step's already-configured `N`; subspec 02 invents a separate `onRevise.maxRevisions`. The spec must explicitly decide whether revise needs an independent budget distinct from any existing write-loop range/attempt concept, or should fold into it — and state why, per the ledger convention's requirement that each decision name the plausible alternative it rules out.

**5. `repeatStepId` needs defined validation.**
Add a decision and acceptance criterion covering rejection of a nonexistent, self-referencing, or forward-referencing `repeatStepId` in `onRevise` config. This is operator-authored config; an undefined reference is a real failure mode, not an edge case to skip.

**6. Discovery of "next unused revision number" must be pinned.**
Subspec 02 must specify how `n` in `${repeatStepId}~r<n>` is derived — a scan over existing run rows by stepId prefix, or a stored counter — since this determines whether `StateStore` needs a new query method. This is implementation-shaping and belongs in the decision ledger, not left implicit.

**7. State the approve-on-last-step and resume-serialization assumptions explicitly.**
Two cheap clarifications, not full redesigns:
- Subspec 01 should note whether approving the last step causes the workflow to converge to `completed` on the same call or requires a subsequent `executeWorkflow` invocation (consistent with existing step dispatch).
- Subspec 02 should state that concurrent `resume` calls against the same run are serialized by existing daemon RPC handling (inherited from kill/pause), rather than leaving this unaddressed. If that guarantee does not already exist, this becomes a real gap requiring its own decision.

**8. Update documentation bullets to match the above.**
Once re-convergence and interim-status semantics (#1, #2) are resolved, `v2/docs/workflow-runner.md` and `v2/docs/daemon-host.md` doc-update sections in subspec 02 must cover them, not just `onRevise` config and error codes.

**Rationale:** Findings 1 and 2 are load-bearing — without them the spec's central mechanism (a decision loop, per the intent) is incompletely specified, which violates the requirement that decisions form a complete, non-speculative ledger rather than leaving core state-machine transitions to the implementer's guess. Findings 3–6 are unresolved ambiguities or unstated implementation-shaping choices that the ledger convention requires to be pinned explicitly (each must name the alternative it rules out). Finding 7 is two low-cost clarifications that remove reviewer guesswork. Finding 8 is a direct bookkeeping consequence of fixing 1–2, required by the documentation-alignment rule for behavior/architecture changes.