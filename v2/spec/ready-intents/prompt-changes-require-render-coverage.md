---
name: prompt-changes-require-render-coverage
---

# Prompt changes require render coverage

Ready finalization verifies changed prompt behavior without treating Markdown punctuation as code operators. A prompt-only change passes only when scoped tests observe the changed template's rendered output; otherwise the failure names the template and missing render coverage.

## Decisions

- Classify changed production paths as code, prompt, or other before selecting verification — rules out applying one mutation catalog to every file.
- Apply the existing guard, comparison, and destructive mutations to code only — rules out changing TypeScript mutation behavior while fixing prompts.
- Keep `prompts/**` in the verified surface — rules out excluding prompt behavior through `NON_PRODUCTION_PATTERNS`.
- Verify prompt artifacts at rendered-output level — rules out character mutations or raw-template text assertions as prompt coverage.
- Report uncovered prompt rendering with the template path and missing-render-coverage reason — rules out presenting it as a surviving character mutation.
- Treat `<base>` and other Markdown angle-bracket prose as non-code punctuation — rules out comparison flips such as `<` to `>=` in prompts.

## Prerequisites

- Ready finalization gates completion on diff-derived verification of changed production paths against run-base-scoped tests.
- Registered prompt artifacts retain their source paths and render through the shared prompt registry.

## Acceptance criteria

- `v2/src/execution/diff-derived-mutation-verifier.test.ts` regression tests for the PR #1894 `<base>` prompt diff and an uncovered changed prompt fail before the change: the former derives no code-operator mutation; the latter names its template and missing render coverage.
- A changed prompt whose rendered output is observed by scoped tests passes prompt verification.
- TypeScript diffs retain the existing mutation candidates, scoped-test execution, restoration, bounds, and result semantics.
- Non-code paths never receive comparison-operator mutations.
- `bun run typecheck` and the required v2 test slices pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — verification behavior by file kind and uncovered-prompt failure.
- `v2/docs/test-writing.md` — rendered-output coverage required for prompt changes.
- `v2/docs/v1-behaviors.md` — record the corrected v2 completion-verifier behavior.
