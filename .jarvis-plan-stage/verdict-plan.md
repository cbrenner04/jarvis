1. Split the oversized subspec into independently testable subspecs covering completion/pending commits, workflow step propagation and recovery, and attribution. Preserve every original task and acceptance outcome exactly once across the replacements, and link every replacement from `index.md`.

2. Define attribution placement precisely. Current output has chronological commit bullets and one combined `Written by …` summary, not per-agent summary groups. Specify how each agent’s `Steps:` counts appear while preserving existing bullets and summary wording, including multi-agent output.

3. Resolve multi-pass review classification. Define which pass and agent own a commit when multiple review cycles or actuator agents contribute before one publication commit. Cover an earlier mutating pass followed by non-mutating approval and participation by different agents.

4. Make recovery behavior complete. Specify and test retained step classification across interrupted pending commits and publication/finalization resume for review, mutation-repair, and ready-gate paths—not only legacy write recovery.

5. Clarify persisted pending-message authority. State how trailer-less legacy messages gain `Jarvis-Step: write`, how existing valid trailers are preserved, and whether retry-time metadata may reclassify an already-prepared transaction.

6. Define attribution parsing boundaries: exact recognized `Jarvis-Step` grammar, duplicate or conflicting step trailers, repeated identical `Jarvis-Agent` trailers, normalization, and their effects on counts and the mixed-kind threshold. Also state that counts use only commits already eligible under the existing `Spec:` attribution filter, with a negative regression for otherwise ineligible commits.

7. Replace the omnibus mutation-checkpoint claim with canonically linked evidence for each focused guard-bearing test. Every modified guard must have a criterion linked to its actual test file and enclosing title, including negative cases for write-only workflows, non-committing reviews, unrecognized trailers, and single normalized kinds. Keep exactly one valid keystone checkpoint per runtime-behavior subspec.

8. Require the repository-mandated verification scope for the resulting diff: `bun run typecheck`, `bun run test:v1`, `bun run test:v2`, and `bun run test:integration:v2`. The v1 documentation and v2 implementation surfaces make all four necessary.
