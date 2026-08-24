---
name: keystone-test-file-matching-is-language-neutral
---

# Make Keystone Test-File Matching Language-Neutral

Unsplit rationale: Test-file recognition, checkpoint selection, and plan-draft rejection diagnostics form one execution-loop admission seam.

## Prerequisites

## Primary implementation surface

- Execution loop: shared checkpoint-criterion admission during plan-draft normalization.

## Problem

- Shared mutation-checkpoint selection recognizes only JavaScript `.test.*` paths, so canonical keystones naming common non-JavaScript tests are rejected as unsatisfiable.
- The rejection echoes a canonical-looking criterion without identifying the filename-pattern mismatch.

## Behavior

- Guard and keystone criteria accept existing JavaScript `.test.*` forms plus `*Test`/`*Tests` files for Swift, Objective-C, Kotlin, and Java, `*_test` files for Go, Python, Ruby, Elixir, and ElixirScript, Python `test_*` files, and Ruby `*_spec` files.
- A canonical criterion naming `ChessPracticeTests/RootContentTests.swift` is selected and is not classified as an unsatisfiable keystone.
- A canonical keystone naming a path outside the recognized test-file patterns is still rejected early, and the operator-facing error identifies the filename-pattern mismatch.

## Decisions

- Use one fixed, language-neutral recognized-pattern set for guard selection, keystone selection, and hollow-pin title detection; rules out divergent classifiers that admit a pin in one checkpoint path but reject it in another.
- Preserve existing JavaScript forms while adding the named ecosystem conventions; rules out replacing compatibility behavior or adding per-project pattern configuration.
- Preserve plan-draft rejection of self-marked but unselectable keystones; rules out allowing silent dead evidence.
- Keep downstream `@mutate` execution and toolchain assumptions unchanged; rules out expanding this fix into non-JavaScript mutation execution.
- Name the unrecognized test filename condition in the rejection; rules out a generic criterion echo that requires a source dive.

## Required verification

- A table-driven shared criteria test covers `ChessPracticeTests/RootContentTests.swift`, `foo_test.go`, `test_foo.py`, `foo_spec.rb`, `FooKtTest.kt`, equivalent accepted spellings, existing `foo.test.ts` and `.test.` forms, and a plain non-test path; it fails against the JavaScript-only classifier.
- A plan-draft normalization test proves a canonical Swift keystone selects and avoids `findUnsatisfiableKeystoneCriteria`; it fails against the pre-fix classifier.
- A plan-draft normalization test proves an unrecognized filename is rejected with text stating that it does not match a recognized test-file pattern.
- `bun run typecheck`, `bun run test:v1`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/test-writing.md` — make the recognized language-neutral test-file spellings the durable pattern reference.
- `v2/docs/workflow-runner.md` — describe the filename-specific plan-draft refusal and cross-link the pattern reference.
- `v2/docs/v1-behaviors.md` — align the existing-behavior parity catalog with widened checkpoint selection and the diagnostic.
