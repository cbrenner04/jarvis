1. Resolve the prerequisite contradiction: current parsing uses case-insensitive substring matching, so text such as `no automated guardrails` qualifies. The spec must either align the intent with that behavior or record a blocker; it cannot claim whole-phrase matching while preserving parser behavior unchanged.

2. Require source-attributable rendered-prompt coverage. Tests must prove that bundled spec guidance and `DEFAULT_WRITE_STEP_RULES` each independently communicate all three markers, case-insensitive recognition, and free placement within the full criterion block. Whole-prompt assertions that could obtain this language from another injected source are insufficient.

3. Account for every consumer of `DEFAULT_WRITE_STEP_RULES`. It is shared beyond the implement path, so the spec must identify the affected write flows and define appropriate regression coverage rather than describing the change as implement-only.

4. Cover the v1 plan guidance path. Because `v1/docs/spec-guidance.md` directly feeds v1 plan draft/review behavior through a separate path, the spec must require focused rendered coverage there or establish why existing shared-path coverage conclusively pins it.

5. Split the plan-guidance and shared-step-rules changes into independently testable subspecs. Every existing task, documentation update, verification command, and acceptance outcome must appear exactly once across the replacements, and every replacement must be linked from `index.md`.
