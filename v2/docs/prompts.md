# Prompts

Registered prompts are artifacts with stable IDs and versions, living in the `prompts/` directory and indexed via `prompts/registry.txt`. Each prompt serves one or more roles and workflows. This doc captures registry-level entries and their usage scope.

## Write-step prompts

### `write.execute`

Default write-step prompt for plan, implement, and standalone write. Injects `SPEC_PATH`, `STEP_RULES`, `PRINCIPLES`, `REPO_GUIDANCE`, and `ACTIVE_SUBSPEC_BODY`. See [`write-behavior.md`](./write-behavior.md#write-step-prompt-placeholders).

### `write.token-reprompt`

One-shot re-prompt issued when the agent's first response carries no terminal token (`done`, `no-work`, `blocked`, `progress`). Injects `RESPONSE_TEXT` (the first response). Used by the step runner; see [`write-behavior.md`](./write-behavior.md#terminal-token).

### `write.blocker-reprompt`

One-shot re-prompt issued when a `blocked` token misses the blocker-text contract. No placeholders. Used by the step runner; see [`write-behavior.md`](./write-behavior.md#terminal-token).

### `write.landing-contract-reprompt`

Re-prompt issued when `intent.prompt.split` staged output fails landing-shape validation before write-loop completion. Injects `VIOLATION`, `OFFENDING_FILE`, and `STAGING_DIR`. Used by the write loop; see [`write-behavior.md`](./write-behavior.md#intent-split-landing-contracts).

### `write.ready-repair`

Re-prompt issued when the ready gate fails during completion publication. Injects `SPEC_PATH`, `STEP_RULES`, `GATE_COMMAND`, `GATE_EXIT_CODE`, and `GATE_OUTPUT`. Used by the write loop's publication boundary; see [`write-behavior.md`](./write-behavior.md#ready-finalization).

### `write.coverage-advisory`

Advisory re-prompt issued after a completing implement write when uncovered changed lines are detected. Injects `COVERAGE_REPORT` (the report text from `reportUncoveredChangedLines`). The advisory is **deliver-only**: the agent's response is logged but does not change the completion outcome, iteration count, or run status. Used by the write loop's completion path; see [`write-behavior.md`](./write-behavior.md#coverage-advisory).
