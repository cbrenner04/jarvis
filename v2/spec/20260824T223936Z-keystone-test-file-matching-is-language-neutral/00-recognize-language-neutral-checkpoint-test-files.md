# Recognize language-neutral checkpoint test files

## Problem

Checkpoint pin consumers recognize only JavaScript `.test.*` files. Canonical guard and keystone criteria naming common Swift, Objective-C, Kotlin, Java, Go, Python, Ruby, or Elixir tests are therefore unselectable; hollow-pin and premise-reachability review can misread their paths as titles or non-test references; and a selected pin can later become `unresolved_pinning_test` at completion. Plan-draft normalization also rejects a canonical keystone without naming the filename-pattern mismatch.

## Surface

Primary: execution-loop checkpoint-criterion admission during plan-draft normalization and completion. In scope: shared pin-file recognition consumed by guard and keystone selection, hollow-pin detection, premise-falsification reachability, and `pinningTestReferenceFromCriterion`; the plan-draft refusal diagnostic; focused tests; and durable docs. Out of scope: directive syntax, mutation execution, toolchain selection, and project-configurable patterns.

## Decision ledger

- One shared fixed predicate recognizes pin files for guard and keystone selection, hollow-pin title detection, premise-falsification reachability, and completion-time pin extraction — rules out admission that cannot resolve and divergent classifiers across checkpoint paths.
- Recognition evaluates only the basename. The listed language patterns are whole-basename anchored and case-sensitive; their `*` stems may be empty. Existing JavaScript compatibility remains unchanged: a basename containing lowercase `.test.` qualifies, as does the existing case-insensitive terminal `.test.[cm]?[jt]sx?` form. This admits exactly `*Test.swift`, `*Tests.swift`, `*Test.m`, `*Tests.m`, `*Test.kt`, `*Tests.kt`, `*Test.java`, `*Tests.java`, `*_test.go`, `*_test.py`, `test_*.py`, `*_test.rb`, `*_spec.rb`, and `*_test.exs` beyond that compatibility — rules out unspecified extensions and per-project configuration.
- A syntactically canonical keystone whose pin filename misses the fixed set remains unsatisfiable and gets a filename-pattern-specific refusal; malformed or prose-only keystones retain the generic unsatisfiable-criterion refusal — rules out admitting dead evidence or misdiagnosing syntax failures as filename failures.
- Recognition widens only pin admission and resolution. Downstream `@mutate` linking, execution, commands, and toolchain behavior stay unchanged — rules out treating recognized non-JavaScript pin names as mutation-runner support.

## Tasks

- Replace the JavaScript-only pin-file checks with one shared language-neutral predicate and route guard selection, keystone selection, hollow-pin detection, premise-falsification reachability, and completion-time pin extraction through it.
- Add focused shared-criteria and premise-falsification coverage for every admitted spelling, retained JavaScript compatibility, empty stems, anchored case-sensitive near misses, an unrecognized ordinary path, and hollow-pin classification.
- Extend plan-draft normalization coverage for canonical Swift admission, the filename-specific refusal of a canonical unrecognized pin, and unchanged generic prose-only refusal.
- Add verifier coverage that a Swift pin extracts, resolves, links its directive, and reaches caught verification rather than `unresolved_pinning_test`.
- Update the durable documentation listed below.

## Acceptance criteria

- [ ] `shared/mutation-checkpoint-criteria.test.ts` test `recognizes language-neutral checkpoint pin files` proves guard and keystone selection accepts `ChessPracticeTests/RootContentTest.swift`, `ChessPracticeTests/RootContentTests.swift`, `RootContentTest.m`, `RootContentTests.m`, `RootContentTest.kt`, `RootContentTests.kt`, `RootContentTest.java`, `RootContentTests.java`, `foo_test.go`, `foo_test.py`, `test_foo.py`, `foo_test.rb`, `foo_spec.rb`, and `foo_test.exs`; preserves `foo.test.ts` and other existing `.test.` forms; treats each recognized pin-only reference as lacking a title during hollow-pin detection; and rejects a plain path plus `latest.swift`, `contest.go`, `mytest.py`, and `spec_helper.rb`. It proves matching is basename-only, whole-name anchored and case-sensitive, with `Test.swift`, `_test.go`, and `test_.py` accepted as empty-stem forms; it fails against the pre-fix JavaScript-only predicate.
- [ ] `shared/mutation-checkpoint-criteria.test.ts` — `recognizes language-neutral checkpoint pin files`; Keystone checkpoint: an in-body `// @mutate` directive reverts the shared recognized-pattern predicate to its JavaScript-only baseline and turns the test red when applied.
- [ ] `shared/module-boundary-surfaces.test.ts` test `a canonical Swift keystone is admitted` normalizes a criterion naming `ChessPracticeTests/RootContentTests.swift`, proves `selectKeystoneCheckpointCriteria` selects it and `findUnsatisfiableKeystoneCriteria` returns no finding, and fails against the pre-fix classifier.
- [ ] `shared/module-boundary-surfaces.test.ts` test `an unrecognized keystone pin names the filename-pattern mismatch` proves a syntactically canonical keystone naming a plain non-test path is rejected before splitting with text stating that its filename does not match a recognized test-file pattern; it fails against the pre-fix generic diagnostic.
- [ ] `shared/module-boundary-surfaces.test.ts` — `an unrecognized keystone pin names the filename-pattern mismatch`; Mutation checkpoint: an in-body `// @mutate` directive inverts the filename-mismatch diagnostic guard and turns the test red without a production inversion hook, while existing prose-only keystone refusal coverage stays green.
- [ ] `shared/module-boundary-surfaces.test.ts` test `a prose-only keystone criterion refuses the staged draft` stays green and its existing in-body `// @mutate` directive remains parseable, proving malformed or prose-only keystones retain generic refusal.
- [ ] `shared/prompts/review-plan-premise-falsification.test.ts` test `recognizes a Swift checkpoint test reference as reachability evidence` proves a criterion naming `ChessPracticeTests/RootContentTests.swift` and its pin title is accepted as a test-based reachable violation, and fails against the pre-fix JavaScript-only classifier.
- [ ] `v2/src/execution/mutation-checkpoint-verifier.test.ts` test `a Swift pin resolves at completion` proves `pinningTestReferenceFromCriterion` extracts `ChessPracticeTests/RootContentTests.swift` and `verifyMutationCheckpoints` resolves, links, and catches its directive without `unresolved_pinning_test`; it fails against the pre-fix classifier.
- [ ] `shared/prompts/review-plan-hollow-pin.test.ts` tests `flags a mutation-checkpoint criterion that omits its pin title` and `does not flag a well-formed criterion that backtick-names its pin title`, `shared/prompts/review-plan-premise-falsification.test.ts` test `does not flag invariant criteria whose violations are reachable on the base`, `v2/src/execution/mutation-checkpoint-verifier.test.ts`, and `v2/src/execution/mutation-checkpoint-keystone.test.ts` stay green; recognition of a non-JavaScript pin does not add mutation commands or alter `@mutate` execution.
- [ ] `v2/docs/test-writing.md`, `v2/docs/workflow-runner.md`, `v2/docs/v1-behaviors.md`, and `v1/docs/spec-guidance.md` match the shipped recognized-pattern set, shared classifier use, completion-time resolution, and filename-specific plan-draft refusal.
- [ ] `bun run typecheck`, `bun run test:v1`, `bun run test:v2`, and `bun run test:integration:v2` exit zero.

## Documentation updates

- `v2/docs/test-writing.md` — define the fixed language-neutral checkpoint pin-file spellings as the durable pattern reference and clarify that recognition does not imply mutation-toolchain support.
- `v2/docs/workflow-runner.md` — describe the filename-specific refusal for canonical unrecognized keystone pins and cross-link the pattern reference.
- `v2/docs/v1-behaviors.md` — update the plan-draft and completion parity entries for widened shared checkpoint selection, hollow-pin and premise-reachability classification, completion-time resolution, and the diagnostic.
- `v1/docs/spec-guidance.md` — cross-link its mutation-checkpoint authoring guidance to `v2/docs/test-writing.md`; keep its JavaScript alternate-extension basename tolerance separate from the broader language-neutral admission patterns.
