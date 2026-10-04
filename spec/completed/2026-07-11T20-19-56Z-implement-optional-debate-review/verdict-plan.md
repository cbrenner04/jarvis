## Verdict — First Review Pass

Uphold the following. Refine the spec to cover each outcome; keep prose terse.

### 1. Define the prompt-rendering/dataflow path for the appended review (subspec 01)
This spec is the **first production consumer** of the `review-debate` behavior — nothing today constructs such a step. The review executor consumes already-rendered adversary/advocate/adjudicator **strings** plus prior-role output, but the existing `patch.prompt.review.*` templates are rendered elsewhere and require injected context (spec tree, branch diff, pass number, prior-role findings). "Bind the debate roles to the patch review prompt IDs" silently skips this integration. The spec must name, as an observable contract, how those templates become the per-cycle, role-chained prompt strings the review step runs — including how prior-role output feeds the next role across cycles. Do not leave this as an implied binding.

### 2. Split subspec 01 (independently testable)
01 currently bundles builder composition + step append, the prompt rendering/dataflow above, terminal ordering/shrink, failure semantics, and three doc updates. The rendering/dataflow path is substantial and independently implementable and testable (its own units, no dependence on "append after implement completes"). Split it out from the post-implement composition. Every original task and acceptance outcome must appear exactly once across the replacements, each linked from `index.md`. This is a scope split, not prose compression.

### 3. Pin review-step location and verdict placement (subspec 01)
State explicitly: the appended review runs in the implement run worktree, and the verdict is written as `verdict-patch.md` beside the executed `index.md`. The review primitive writes to a caller-supplied path and does not inherit v1's beside-spec convention, so this must be pinned rather than assumed.

### 4. Pin or defer the first-consumer primitive semantics (subspec 01)
Because this is the first production use of the review primitive, 01 leans on behaviors that are currently only test-exercised. The spec must resolve, for each: (a) whether actuator edits from the review receive the same commit handling as implement writes, (b) verdict overwrite/cleanup across cycles, and (c) reviewer read-only enforcement. Either pin each outcome or explicitly defer it to the primitive with a stated expectation (`Deferred to first consumer: … — pin when a caller needs it`). Do not promise "prompt/verdict contracts" while leaving these unaddressed.

### 5. Specify invalid project-config value handling (subspec 00)
00 specifies only the **absent** project value (defaults to `0`) and CLI validation. It does not say what happens when the project's `implement.reviewPasses` is present-but-invalid (fractional/negative/malformed) or **when** that failure surfaces (at config read vs. at effective-count resolution). Add the invalid-project-value outcome and its timing as an acceptance criterion.

### 6. Add the CLI-flag doc home (subspec 00)
The canonical operator home for the `jarvis run workflow` CLI surface is `v2/docs/write-behavior.md`. The new `--review-passes` flag is a CLI-contract change and must be documented there, in addition to the install-config and walkthrough updates already listed.

### 7. Name the metadata owner and wire placement (subspec 02)
There is no top-level workflow-metadata field today; "workflow snapshot metadata" is underspecified. 02 must name the concrete durable owner (the field on the workflow snapshot carried by the implement write step's run row) and, on the wire, specify: where `reviewPasses` sits on the daemon list row / TUI run data, its representation for non-implement workflows that have no such value, and confirmation that the zero case is always present (numeric, never absent). This is a harness subspec, so the placement **is** the contract.

### 8. Clarify positive-review gating on non-completable indexes (subspec 01)
Add one line making explicit that an empty or already-complete index counts as non-completion for review gating — the appended review **skips** rather than hard-fails — so an `already_complete` outcome is not misread as a trigger to review.

---

### Not upheld
- **"Empty/already-complete index produces no run row"** — false; the implement write step creates a durable run row unconditionally, so the metadata owner in item 7 always exists. Do not redesign persistence around this.
- **`v1-behaviors.md` in 00 and 02** — this feature is v2-only net-new; a single consolidated entry (already in 01) is correct. Do not fragment it across subspecs.
- **Test-file naming in ACs** — these are harness subspecs where naming canonical test files is permitted convention; no change required.