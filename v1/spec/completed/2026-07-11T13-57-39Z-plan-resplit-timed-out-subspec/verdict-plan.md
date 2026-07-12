- Pin an explicit callable recovery action while leaving its spelling deferred; define its plan/branch/worktree/PR lifecycle separately from ordinary `--resume`.

- Define qualifying timeout evidence, its recorded source, and refusal for missing, malformed, or non-iteration timeout history; idle/run timeouts must not qualify.

- Define valid targets: an unchecked, uniquely linked subspec within the selected tree; reject malformed, duplicate, missing, or out-of-tree links without mutation.

- Define recovery atomicity: draft replacements from sufficient original context, validate them as a normal spec tree, preserve completed neighbors, and leave the original tree intact on drafting or validation failure.

- Define replacement reconciliation: two-or-more collision-safe replacement files, index ordering/check state, old-file disposition, and supported structured cross-reference forms/files must resolve with no stale target. Arbitrary prose need not be rewritten.

- Define handling for pending timeout checkpoints/partial implementation so recovery cannot silently lose or misapply saved work.

- Replace the ordinary-resume preservation AC with an anchor to the existing resume test(s), per refactor-preservation guidance.

- Clarify the relationship to the existing three-timeout blocker and update the canonical `v2/docs/v1-behaviors.md`, operator `v1/docs/plan-mode.md`, and runbook accordingly. This is required because the recovery changes operator workflow semantics; the current manual-surgery guidance cannot simply disappear without documenting the new boundary.
