# Verify prompt rendering by file kind

Ready finalization currently applies code-oriented text mutations to every changed production file. Markdown prompt prose can therefore be misread as operators, while a prompt change with no rendered-output coverage can pass with zero candidates.

## Decisions

- Classify production changes as code, registered prompt artifacts, or other before verification — rules out applying the code mutation catalog to Markdown and unrelated files.
- Keep guard, comparison, and destructive mutations unchanged for code paths — rules out weakening established TypeScript verification while adding prompt coverage.
- Verify a changed registered prompt through its rendered output under scoped tests — rules out accepting raw-template reads or punctuation mutations as behavioral coverage.
- Fail uncovered prompt rendering with the template path and a missing-render-coverage reason — rules out reporting a surviving character mutation.
- Keep `prompts/**` production-visible — rules out bypassing prompt verification through non-production filtering.

## Scope

- Add file-kind-aware verification for changed and untracked production paths.
- Add rendered-output coverage verification for changed registered prompt artifacts.
- Preserve code mutation execution, restoration, bounds, scope selection, and results.
- Update the durable verifier and test-writing contracts.

## Acceptance criteria

- [x] `v2/src/execution/diff-derived-mutation-verifier.test.ts` regressions for the PR #1894 `<base>` prompt diff and an uncovered changed prompt fail against the baseline and pass after the change; `<base>` produces no code-operator mutation, and the uncovered result names the template path with a missing-render-coverage reason.
- [x] `v2/src/execution/diff-derived-mutation-verifier.test.ts` proves a changed registered prompt passes only when scoped tests observe its rendered output; raw-template inspection alone does not count.
- [x] `v2/src/execution/diff-derived-mutation-verifier.test.ts` proves non-code paths receive no guard, comparison, or destructive mutation candidates while `prompts/**` remains in the inspected production surface.
- [x] `v2/src/execution/ready-finalize.test.ts` proves missing prompt render coverage stops ready finalization and reports the template path and missing-render-coverage reason; the test fails against the baseline.
- [x] Existing code-path cases in `v2/src/execution/diff-derived-mutation-verifier.test.ts` stay green, preserving mutation candidates, scoped-test execution, restoration, bounds, and result semantics.
- [x] `v2/docs/workflow-runner.md` documents ready-finalization verification by file kind and the uncovered-prompt failure.
- [x] `v2/docs/test-writing.md` requires scoped tests to observe changed prompt rendered output rather than raw template text.
- [x] `v2/docs/v1-behaviors.md` records the corrected v2 completion-verifier behavior.
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — verification by file kind and uncovered-prompt failure.
- `v2/docs/test-writing.md` — rendered-output coverage for prompt changes.
- `v2/docs/v1-behaviors.md` — corrected v2 completion-verifier behavior.
