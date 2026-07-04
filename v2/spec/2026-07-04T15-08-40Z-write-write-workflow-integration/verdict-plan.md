1. The spec must require evidence that both workflow steps perform their own `role`→binding resolution inside the workflow run, not just that a two-step preset eventually succeeds. With both steps using `implement`, success alone could still hide incorrect binding reuse or single-resolution behavior, which would fail the intent’s end-to-end proof of real per-step resolution.

2. The spec must make step ordering observable: step one completes before step two begins. Final two-step success and separate durable records do not by themselves prove advancement semantics, yet the intent explicitly requires “step one’s write loop completes, the runner advances to step two, step two’s write loop completes.”

3. The fallback requirement must name the source of fallback unambiguously: the loaded project agent/model config as reached through role resolution within workflow execution. “Project agent fallback” is currently loose enough to imply a separate workflow-only mechanism, which weakens the proof this slice is supposed to provide.

4. The acceptance criteria must match the stated durability contract by requiring separate per-step attempt history, not only separate completed records. The decisions and task list already elevate durable attempt history as the observable contract; relaxing that in the ACs invites a weaker implementation target.

5. The doc requirement should explicitly anchor why durable docs change here: this slice establishes the supported composed workflow contract and its durable-state behavior, not just a private test proof. Without that clarification, the current doc scope reads broader than the intent justifies, which conflicts with the repo rule against speculative doc churn.
