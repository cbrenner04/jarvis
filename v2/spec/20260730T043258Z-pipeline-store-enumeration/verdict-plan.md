1. Require enumeration coverage across persisted pipeline statuses, including both `active` and `interrupted`, so “every admitted pipeline” cannot be implemented as implicit status filtering.

2. Require preservation of complete persisted pipeline and stage records after reopen—not only stage ID, status, and workflow invocation ID—including nullable metadata and failure/artifact fields. This validates the repository’s typed durable-record contract.

3. Explicitly define or defer call-level snapshot consistency between pipelines and their stages. Leaving concurrent-read consistency unspecified creates an ambiguous repository contract.

4. Define collection semantics: an empty store returns an empty collection, and each pipeline and associated stage appears exactly once. Regression coverage must detect omissions, duplication, incorrect association, and authored-order errors.

5. Distinguish persisted pipeline reconciliation status (`active`/`interrupted`) from daemon-derived execution progress. Require the documentation update to correct the existing contradictory claim that no pipeline-level status is stored and clearly preserve the boundary that persistence does not derive lifecycle progress.

The work remains one atomic subspec because all refinements concern the same enumeration operation, regression surface, and repository documentation.
