# Diff-derived mutation verifier

A standalone verifier that proves a run's changed production guards are actually
constrained by its tests: it derives candidate mutations from the production
diff against the run base, applies each against the run-base scoped test suites,
and requires each to break at least one test. Net-new internal module; its first
consumer is subspec 01 (the mandatory completion boundary).

## Decisions

- Derive candidates from the `<runBase>...HEAD` production diff (plus untracked production files); rules out a fixed generic mutation catalog blind to the run's actually-changed guards.
- Classify candidates from the changed lines into changed subprocess arguments, fail-closed guards, and destructive-operation safety choices when present; rules out limiting mutation to syntax-level operator swaps.
- Validate each mutation against the run-base scoped suites via `resolveCiTestScope`; rules out re-running the full suite or a hand-picked test list divorced from the ready gate's scope.
- Caught = at least one scoped test fails under the mutation; a still-green scoped suite is a surviving mutation; rules out treating "tests ran" as evidence.
- Bound applied-mutation count and total verification wall-clock, inspecting only changed production files; rules out a full-repository sweep dominating implement wall clock.
- Restore the tree after every applied mutation and before returning any terminal result; rules out leaving mutated bytes for a caller to publish.
- Zero candidates is a passing result carrying the run base, inspected production paths, and zero count; rules out an unexplained skipped check.
- Surface a surviving mutation by naming the mutation and its source site; rules out an undiagnosed generic failure.
- Exercise git and scoped-test execution through injected seams; rules out live subprocess/test runs in unit coverage.

## Task checklist

- Add the verifier module under `v2/src/execution/` with git-diff and scoped-test-runner seams.
- Derive + classify candidates from the run-base production diff; enforce count/time bounds over changed files only.
- Apply → run scoped tests → require ≥1 failure → restore, per candidate.
- Return a structured pass (run base, inspected paths, candidate count) or surviving-mutation failure (mutation + source site).
- Co-locate the test file next to the module.

## Acceptance criteria

- [x] The verifier derives candidate mutations only from files present in the `<runBase>...HEAD` production diff and untracked production files, and never mutates a production file absent from that change set.
- [x] Candidate derivation covers changed subprocess arguments, fail-closed guards, and destructive-operation safety choices found in the changed lines, rather than a fixed source-agnostic operator-swap set.
- [x] Each candidate is applied, the run-base scoped suites resolved via `resolveCiTestScope` run against the mutated tree, and the candidate counts as caught only when at least one scoped test fails.
- [x] A changed production guard with no covering scoped test returns a surviving-mutation failure that names the surviving mutation and its source site.
- [x] A zero-candidate production diff returns a passing result recording the run base, the inspected production paths, and a zero candidate count.
- [x] Applied-mutation count and total verification wall-clock are bounded; hitting a bound ends verification without inspecting remaining or unchanged files.
- [x] The worktree carries no mutated bytes after any terminal result (caught-all pass, surviving-mutation failure, zero-candidate pass, or bound stop).
- [x] A new co-located test drives the verifier through injected git-diff and scoped-test-runner seams to a surviving-mutation result for an uncovered changed guard and asserts the named mutation and source site; it fails against the pre-fix tree (no verifier exists) and passes after.

## Documentation updates

- `v2/docs/write-behavior.md` — mutation selection, bounds, evidence, and restore semantics of the verifier.
