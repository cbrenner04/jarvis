## Verdict

Four refinements required; one is blocking.

### 1. Resolve the rendered-snapshot break (BLOCKING)

The patch rules body is embedded verbatim in the rendered-prompt snapshot fixtures, and `rendered-snapshots.test.ts` both compares `buildPrompt(...)` against those fixtures (shared + codex-exec wrapper variants) and hard-asserts the `patch.prompt.body` registry revision. Adding any line to `rules.md` changes the rendered output and the fixture key, so the draft's AC #4 (`bun run test` passes) is unsatisfiable as written — the task list never touches the prompt-body fixtures or revision assertion.

The spec must:
- **Decide** whether the `patch.prompt.body` revision also bumps (the spec's own rationale — "revision is the change-visible marker for snapshot keys" — argues the container whose rendered content moves should bump too), and record that decision with the wrong alternative it rules out.
- **Add tasks** to regenerate the affected prompt-body snapshot fixtures (shared and wrapper) and update the revision assertion in `rendered-snapshots.test.ts`.
- **Add an acceptance criterion** covering the snapshot regeneration so it cannot be silently skipped.

### 2. Name the concrete doc-citation set

The documentation-update item says to update `patch.rules` revision citations "that describe still-current behavior," but in `v1-behaviors.md` *all* such citations describe current behavior, so the qualifier carries no signal and invites under-editing — notably a revision token embedded inside a heading is an easy miss. The spec must name the concrete set of `(revision 7)` occurrences to bump (including the in-heading one) and state explicitly that the bare `prompts/patch/rules.md` citations without a revision stay as-is.

### 3. Pin the rule wording and the test's match target

AC #2's added test and the rule text are both unpinned, risking a brittle exact-prose assertion (and the existing whole-body `toContain` already covers any new line mechanically). The spec should pin the canonical sentence to add to `rules.md` in Decisions, and direct the new test to assert a stable keyword (e.g. `git commit`) rather than full prose, so the regression guard documents intent without coupling to exact wording.

### 4. Name the placement section

The placement decision references two sections ("`## Stop`/`## Iteration`"). A during-work "do not self-commit" constraint belongs under `## Iteration`, alongside the existing "Jarvis owns the index checkbox" rule of the same Jarvis-owns-this-surface shape. Name that single section.

### Not in dispute
The `v2/docs/v1-behaviors.md` inclusion is correct (injected-guidance change is observable behavior), and ACs naming the prompt file and revision are appropriate because structure is the contract for harness subspecs. No findings are over-reaches.