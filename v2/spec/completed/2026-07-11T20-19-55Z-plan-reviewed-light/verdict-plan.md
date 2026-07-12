## Verdict — Required Refinements

**1. Split subspec `01` into two independently testable subspecs.**
`01` bundles two separable changes: (a) executing a critic-actuator review over live post-draft plan context (rendering `plan.prompt.review-actuator` against the materialized draft, resolving review `cwd`, writing `verdict-plan.md`, and publishing actuator edits), and (b) preset registration, CLI parsing/validation, and loader composition that appends the review step. These have distinct tests and distinct failure surfaces. Split them, link both from `index.md`, and preserve every original task-checklist item and acceptance outcome exactly once across the two replacements — do not drop or duplicate any. Publication of reviewed output (actuator edits landing in the committed/PR'd spec tree) belongs with the runtime path, not the composition path.

**2. Pin the actuator's live-context rendering contract.**
The generic `review` behavior forwards only a verdict to its actuator; it does not itself supply the draft, intent, or spec guidance. The spec must state that the light step renders `plan.prompt.review-actuator` against the materialized draft (not builder-time metadata), and must name the runtime data sources it consumes. Without this, an implementer could wire a review step that runs but has no draft to act on.

**3. Name the critic's placeholders and their runtime sources in `00`.**
`00` currently says the critic gets "plan review context" without naming it. Specify the placeholders (`WORKDIR`, `NAME`, `INTENT`, `CURRENT_SPEC`, `SPEC_GUIDANCE`) and the runtime source that fills each, and require the artifact/tests to assert them. This is a harness subspec where prompt structure is the contract (per spec guidance), so naming the compatibility surface is appropriate and necessary.

**4. Define review `cwd` and verdict path resolution against materialized state.**
State that review `cwd` and `<spec-dir>/verdict-plan.md` resolve from the worktree/spec directory after the draft is built, not from source-step metadata. The verdict must land at the same published spec directory the actuator edits.

**5. Resolve the read-only status of the critic.**
"Read-only editorial" is currently only a prompt instruction with no enforcement. The spec must either specify plan-review boundary enforcement (no edits/commits by the critic) or explicitly define the critic role as advisory-only with the actuator as the sole mutator. Leave no ambiguity about who can write.

**6. Pin the `--review-passes` grammar.**
"Non-negative" is underspecified. Define the accepted integer syntax and require rejection of malformed/prefix inputs (e.g. `1x`) before daemon contact, alongside the existing rejection of `--review-behavior` on this preset. The zero-pass draft-only equivalence to `plan` must remain an explicit criterion.

**7. Add end-to-end acceptance coverage; builder/CLI assertions are insufficient.**
Current criteria assert routing, bindings, and prompt IDs but never prove the composed workflow's result. Add criteria verifying that, for positive passes, actuator edits are published into the spec tree, `verdict-plan.md` persists at the published spec directory, and the completion artifact (commit / draft PR) includes both. This closes the gap between "the step is wired" and "the step produces the intended output."

**8. Complete the documentation scope.**
Beyond the operator, runner, and v1-behaviors docs already listed, add `v2/docs/prompts.md` (owner of the new prompt and its rendering contract) and `v2/docs/write-behavior.md` (owner of the changed generic review/actuator contract). Place each doc update in the subspec whose change it documents.

*Rationale:* The intent requires a composed light-review path that renders live plan context and publishes a durable verdict; the draft specifies the wiring but not the runtime rendering, publication, or enforcement outcomes that make it correct. The `01` split satisfies the atomic, independently-testable subspec rule in spec guidance; the added end-to-end criteria satisfy the requirement that acceptance criteria verify observable outcomes rather than internal structure alone.