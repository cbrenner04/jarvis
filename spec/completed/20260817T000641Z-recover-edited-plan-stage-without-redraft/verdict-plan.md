- Resolve the sidecar-history contract. State whether staging artifacts are forbidden only from the final publication commit/tree or from all published branch history, then align checkpoint, landing, completion, regression, and documentation outcomes with that choice. The current final-tree assertions do not prove the intent’s broader “never commits a staging sidecar” wording.

- Define recovery handling for the harness-authored `## Blocker` left in staged `intent.md`. A corrected stage must neither be rejected solely by stale harness metadata nor publish that stale blocker, while operator-authored blockers must not be silently removed.

- Split the oversized subspec into independently testable subspecs covering recovery admission/context and review continuation, validation/durable landing, and commit-sidecar behavior. Link every replacement from `index.md`, and place every original task and acceptance outcome exactly once across them; retain end-to-end recovery coverage.

- Define the operator-reachable recovery request and stopped-run selection contract. Specify the required relationships among the run, workflow step, stage, captured context, worktree, and branch, with representative refusals for missing context, mismatched identity, and unrelated staging. Ordinary resume eligibility must remain unchanged.

- Make failed-validation retention semantics precise. Cover representative shape, normalizer, Markdown, and landing failures; prove validation occurs before review, publication, or ready-intent consumption; and state whether preservation means byte-for-byte rollback or retained normalized staging. The outcome must be consistent across failures.

- Require the full plan contract to be revalidated after any review actuator changes staged files and immediately before landing. A post-review contract failure must retain recoverable staging and the ready-intent without partial publication.

- Reconcile the durable-file contract with current numbered-file behavior. Define the outcome for unlinked numbered Markdown and prove ordinary and recovered publication use the same linked-file contract, including explicit unlinked-file coverage.

- Ensure every added or modified admission, draft-bypass, validation-ordering, failure-retention, landing-allowlist, and sidecar-publication guard has a linked mutation checkpoint; retain one valid keystone for the headline recovery behavior.

- Add `v2/docs/write-behavior.md` to the required documentation updates because excluding `verdict-plan.md` changes its documented publication behavior.

- Define Git-disabled recovery. Either prove recovery is storage-agnostic with no-Git coverage or explicitly refuse it with a named outcome; leaving an existing supported publication mode unspecified makes the recovery contract incomplete.
