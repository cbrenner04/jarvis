1. Cover real linked-index daemon resume. Tests must use routed step IDs such as `implement~link-N` and prove both authored-step matching and active-subspec artifact reconstruction; synthetic exact-`implement` fixtures are insufficient.

2. Make resumed iteration accounting crash-consistent. The recovered count must come from authoritative durable state aligned with each committed progress boundary; `loop_finished` alone may lag and grant extra iterations. Verify no fresh budget or extra invocation after interruption.

3. Define iteration-ceiling persistence semantics: normalization of absent versus explicit-default values, authored ceiling changes on redispatch, invalid persisted values, legacy fallback, and consistent comparison/reconstruction behavior.

4. Preserve hollow mutation identity. Each hollow finding must identify the specific inert directive/mutation, support multiple directives for one criterion, and have deterministic ordering and deduplication. The prompt and durable event must carry enough identity to satisfy the intent’s “named mutation” requirement.

5. Add direct lifecycle and precedence proof. Cover guard context surviving ordinary `progress`, clearing on success, terminal hard miss, and exhaustion, plus actual pending-context precedence `mutation-directive → guard-checkpoint → keystone-directive`. Sequential guard-then-keystone routing alone does not prove contention precedence.

6. Split subspec 00 into independently testable slices: guard report modeling/path projection and write-loop admission/lifecycle/prompt/event behavior. Place every original task and acceptance outcome exactly once across the replacements, link every replacement from `index.md`, and ensure each executable-behavior slice independently meets failing-test and mutation-checkpoint guidance.

7. Split subspec 03 into independently testable snapshot ceiling persistence/comparison and durable consumed-count recovery/daemon admission, retaining integration proof that both restored values constrain one resumed run. Distribute every original task and acceptance outcome exactly once and link every replacement from `index.md`.

8. Precisely distinguish malformed directive syntax from existing mutation-repair reasons. Preserve `target_absent` and `target_ambiguous` eligibility for the existing mutation-directive reprompt while hard-blocking only the genuinely non-repairable reasons required by the intent.

9. Add durable append/readback coverage for `guard_checkpoint_reprompt`, not only constructed-record replay, so the structured finding payload is proven to survive log persistence unchanged.

10. Prove guard `pinPath` is the resolved criterion pin for both unlinked and hollow findings, rather than directive metadata, including the hollow case. Existing general basename-resolution coverage need not be duplicated.

11. Replace vague preservation criteria with anchored criteria naming the relevant existing tests in `v2/src/execution/write-loop.test.ts` and `v2/src/daemon/daemon-resume.test.ts`, as required by the preservation-AC guidance.
