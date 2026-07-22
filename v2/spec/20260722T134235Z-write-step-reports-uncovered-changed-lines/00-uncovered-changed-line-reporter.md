# 00 - Uncovered changed-line reporter

## Problem

Nothing computes which of a run's changed production lines no test executes. The mutation
verifier derives candidates from the run-base production diff but only reports lines whose
*mutants* survive; a line no test ever reaches produces no signal until the verifier stalls
the run after write, review, commit, push, PR, and a green ready gate.

Build the reporter as a standalone module with injectable seams. No caller yet — subspec 01
wires it into the write step.

## Decisions

- Diff the working tree (`git diff <runBase>` plus untracked production files), not
  `<runBase>...HEAD` — rules out the mutation verifier's committed-diff form, which is empty
  at the point the write step needs the report because Jarvis commits after the completion boundary.
- Reuse `changedPathsFromDiff` / `parseDiff` from `diff-derived-mutation-verifier.ts` by moving
  them into `diff-scan.ts` (already the shared diff plumbing home) and importing them back —
  rules out a second private diff parser drifting from the verifier's notion of "changed production line".
- Restrict the report to added lines in changed production files whose extension matches the
  verifier's `isCodePath` — rules out reporting markdown, JSON, and prompt files, which have no
  coverage records and would otherwise appear 100% uncovered.
- Collect coverage with exactly one `bun test --coverage --coverage-reporter=lcov` invocation
  over the directories implied by `classifyChangedPaths` — rules out a repo-wide run and rules
  out per-file runs (the `test:v*` scripts spawn one `bun test` per file, so their lcov output
  would be overwritten per file rather than unioned).
- Write coverage output under the worktree's gitignored `.scratch/` and delete it after parsing —
  rules out a tracked path that the completion commit's `git add -A` would absorb.
- A changed code file absent from the lcov output counts as fully uncovered — rules out treating
  "no record" as "nothing to report", which is exactly the never-imported case this exists to catch.
- Fail soft: a non-zero, timed-out, or unparseable coverage run returns no report rather than
  throwing — rules out an advisory signal that can fail a run.
- Return the uncovered sites as data plus the rendered agent-facing text from one call — rules out
  a caller that has to re-derive the prose.
- Report text names file and line only; it computes no percentage, ratio, or threshold, and it
  states that executed ≠ asserted and that the mutation verifier decides adequacy.
- Pin lcov parsing against a checked-in fixture captured from real `bun test --coverage` output —
  rules out a hand-invented format that drifts from Bun's, without paying a real coverage subprocess
  in the agent suite.

## Acceptance criteria

- [ ] Given a run-base working-tree production diff and coverage data, the reporter names each
      changed production code line no test executed, as `<file>:<line>`.
- [ ] A changed production line the coverage data records as executed is absent from the report.
- [ ] A changed production code file with no coverage record at all has all of its added lines reported.
- [ ] Changed non-code files (docs, specs, prompts, JSON) produce no reported lines.
- [ ] Coverage collection issues exactly one `bun test --coverage` invocation, scoped to the
      directories derived from the changed paths, and no repo-wide or per-file run.
- [ ] No coverage percentage, ratio, or threshold is computed or emitted anywhere in the module or its output.
- [ ] The rendered report text states that an executed line may still be unasserted and that the
      mutation verifier, not coverage, decides adequacy.
- [ ] A coverage run that exits non-zero or emits unparseable output yields no report and no thrown error.
- [ ] `uncovered-changed-lines.test.ts` pins the `cleanup.ts:161` shape — an unreachable fallback
      branch inside the diff whose lcov hit count is `0` while sibling changed lines are non-zero is
      reported as uncovered; it fails against the pre-change code (the module does not exist).
- [ ] lcov parsing is pinned against a checked-in fixture captured from real `bun test --coverage --coverage-reporter=lcov` output.
- [ ] Tests fail when each added guard is inverted: inverting the code-path filter makes the
      non-code-file case report lines; inverting the executed-line filter makes the covered-line
      case report a line; inverting the fail-soft guard makes the failed-coverage-run case throw.
- [ ] `diff-derived-mutation-verifier.test.ts` stays green (the diff-parser move is behavior-preserving).
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — new section documenting the uncovered-changed-line reporter:
  working-tree diff scope, single scoped coverage run, code-path restriction, fail-soft behavior,
  and that it emits no percentage.
