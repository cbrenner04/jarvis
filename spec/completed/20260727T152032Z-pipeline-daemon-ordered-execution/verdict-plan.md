## Verdict — refinement required

The draft encodes the posture→preset half of stage dispatch in good detail but leaves the surrounding contracts for the implementer to invent. Refine the following before implementation.

### Blocking

1. **Name the admission surface the loop hangs off.** No pipeline entry point exists in the daemon today, and CLI start/list/wait belongs to a later slice. As written, the headline criterion ("the admitting client disconnects before stage one settles") names an actor this slice does not build. Decide and state either that this slice adds a minimal daemon-side admission entry point whose caller returning is what the test exercises, or that the criterion is restated as daemon ownership without a client. Prefer the former; the latter risks a test that proves nothing. The criterion's wording must match whatever is decided.

2. **Specify how builder input is assembled.** A stage row carries only `{stageId, kind, workflow, review}`; the workflow-step builders need project/cwd, config path, target dir, and the seed/intent/spec input. The spec is silent on where those come from — this is the larger half of stage → invocation translation and is currently hidden behind "fake step-binding fixtures." State what pipeline-level context is carried into each stage's build and where it originates. Fold `reviewPasses` (and any other review knob the builders take) into the same "no silent project default" rule already applied to `reviewBehavior`.

3. **Decide whether stage N+1 consumes stage N's artifact.** As drafted the artifact reference is write-only, which makes an `intent → plan → implement` pipeline meaningless (plan consumes the intent stage's output). Either specify the hand-off or list it explicitly under "Deferred to first consumer." Silence is not a scope decision. Also pin whether the recorded spec path is stored worktree-relative or resolved.

4. **Define terminal success.** "Non-success workflow result" carries the whole failure/settlement contract and is undefined; a run row can read `completed` while representing a failed outcome. State the predicate in terms of the workflow result/run status the dispatcher observes.

5. **Name the settlement signal the progression gate reads.** The daemon's workflow-start path resolves at run creation, not at settlement, so "await the invocation promise" is not merely weaker than reading the stage row — it is unavailable through the path the spec mandates. Say what the loop waits on and how it learns a stage settled. Cut the restart-survival justification from the gate rationale; restart reconciliation is a later slice's contract and does not belong in this spec's reasoning.

6. **Name the dispatch seam.** The workflow-start path is a closure inside the daemon factory, not an exported function, so a standalone stage-dispatch module cannot call it as described. Pin the seam (e.g. an injected dispatch callback supplied at daemon construction) so the module stays unit-testable and the implementer is not inventing structure.

### Required, one decision each

7. **Derived pipeline state predicate.** Keeping settlement derived from stage rows (no new column) is sound, but the derivation is undefined and today collapses running, failed, approval-stopped, and never-dispatched into "not all succeeded" — with `pending` meaning both "admitted" and "skipped after a failure." Define the derived states (running / succeeded / failed / awaiting-approval) and give skipped-after-failure a representation distinguishable from not-yet-dispatched. A sibling slice already speaks of non-terminal and boundary-terminal pipelines; this predicate is its input.

8. **Start-time dispatch refusals.** The daemon's start path returns errors for claimed worktrees, insufficient memory, materialization failure, routing read failure, and invalid params. The spec covers build errors and settlement only. State that a refusal records stage failure and settles, with retry/queueing explicitly deferred.

9. **Idempotency.** State that one loop runs per pipeline and a stage already `running` is never re-dispatched.

10. **Cancellation / non-settling stages.** State that a killed or abandoned stage run falls out as non-success and settles the pipeline; pipeline-level kill defers to the CLI slice.

11. **Ownership-key contention.** One explicit out-of-scope line covering two pipelines targeting the same project and interaction with existing run queuing — rather than silence.

12. **Single source of truth for realizable `(workflow, review)` pairs.** The posture→preset table duplicates the existing validation predicate; name which is authoritative.

13. **Observability deferral.** One line noting pipeline stage runs are not yet attributable in run listings.

### Convention and structure

14. **Split subspec 00 along the resolve/dispatch seam.** Once (2) and (3) are answered it holds two independently testable units: (a) stage + pipeline context → executable workflow steps (pure: the posture table plus builder-input assembly, including the build-failure path), and (b) dispatch plus stage lifecycle write-back (needs the dispatch seam, the store, and the artifact envelope). Produce two subspecs, both linked from `index.md`, with every existing task and acceptance outcome from 00 appearing exactly once across them. This is a testability split, not prose compression.

15. **Anchor the failing-test criteria on behavior, not file existence.** "`<new test file>` fails against the pre-change code" is trivially true for any new file. State the behavior each test pins; the guard-inversion criteria then carry the real weight.

16. **Add a guard-inversion criterion for the approval-stage stop** in the progression subspec — the other two guards there have one.

17. **Move stage status vocabulary documentation to `daemon-host.md`.** The status column is opaque to the state store and never interpreted there; the vocabulary is daemon-owned. Keep `state-store.md` to the durable-row and derived-settlement documentation.

### Not upheld

- The claim that the entry run row's spec path is a staging directory is wrong; the durable entry run row does carry the durable spec path for both intent and plan. Keep the artifact envelope's "spec path read off the entry run row" as drafted, subject only to the relative-vs-resolved clarification in (3).
- The decision to derive pipeline settlement from stage rows instead of adding a status column stands; only its predicate needs defining.