---
name: test-suite-wall-clock
---

# Test suite wall clock

## Problem

Tests are slow in CI and locally. Measured on `main` CI (2026-09-16): `Test (v2)` 250–300s → 309–375s over two weeks (127 → 202 v2 test files); `Test (v2 integration)` 11–17s → 55–58s after the self-handoff chain (#3864–#3894). Summed v2 file time is 679s against ~370s wall. Slowest files: `workflow-runner-resume` 112s, `workflow-runner-intent` 84s, `intent-output` 49s (flat ~1.45s per test), `write-loop-intent-landing` 43s, `write-loop-staged-markdown-lint` 27s. Four independent causes:

1. **Real markdownlint in unit tests.** `validateIntentStage` → `runMarkdownlintAutofix` (`shared/intent-stage.ts:192`) and `lintStagedMarkdown` (`v2/src/execution/staged-markdown-lint.ts:129`, called unseamed at `workflow-runner-resume.ts:849`, `:864`) spawn a real `bun markdownlint-cli2` per landing. No unit test injects a stub.
2. **Real-spawn daemon integration files.** `daemon-self-handoff-real-spawn` (14.0s), `daemon-changeover` (10.1s), `daemon-self-handoff` (6.7s) run in the serial phase; they wait on fixed sleeps and bounded polls (`daemon-self-handoff-real-spawn.sandbox-unrunnable.test.ts:56`, `:126`) and boot a daemon per test.
3. **One oversized file.** `workflow-runner-resume.test.ts` is 5015 lines / 68 tests / 112s and holds one pool slot for its whole run.
4. **Per-test git fixture setup.** Fixtures such as `intent-output.test.ts:9-17` run `init`/`config`/`commit` (≈5 git execs) per test.

## Decisions

- Markdown lint becomes an injectable dependency on the intent-landing and staged-lint paths; unit tests use a stub. One real-binary test per path stays, in the integration slice. Production default is unchanged.
- Real-spawn daemon tests set the smallest sampling/poll intervals the contract allows, replace fixed sleeps with condition waits, and share a daemon boot within a file where tests do not depend on a fresh one. Coverage of real processes is unchanged.
- `workflow-runner-resume.test.ts` splits by describe-group into sibling `workflow-runner-resume-*.test.ts` files with identical test titles; no test is dropped or rewritten.
- A shared test-support helper creates a template git repo once per file and copies it per test; converted fixtures keep their initial commit content.
- CI pool width is out of scope (operator decision).

## Acceptance criteria

- [ ] No unit-slice test spawns `markdownlint-cli2`: a structural test fails when a file outside the integration slice reaches the real lint runner; the one-real-binary tests exist per path.
- [ ] `intent-output.test.ts` per-test time falls below 0.5s (measured, recorded in the PR body with before/after).
- [ ] The three real-spawn daemon files' combined time drops by at least a third (before/after in the PR body) with the same test titles passing.
- [ ] The split resume files together carry exactly the original test titles (a title-count comparison against the pre-split file, recorded in the PR body); no single resulting file exceeds 40s.
- [ ] At least `intent-output`, `write-loop-intent-landing`, and `workflow-runner-intent` fixtures use the template-repo helper.
- [ ] Test count per slice is unchanged or higher versus the merge base.
- [ ] `bun run typecheck`, `bun run test`, and `bun run check` pass.

## Documentation updates

- `v2/docs/test-writing.md` — lint stub seam, template-repo helper, real-spawn wait guidance.
