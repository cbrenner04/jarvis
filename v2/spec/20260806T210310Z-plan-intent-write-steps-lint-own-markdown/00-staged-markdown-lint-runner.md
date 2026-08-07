# Staged-path markdownlint runner

## Problem

Plan and intent write steps stage Markdown under `.jarvis-plan-stage/` and `.jarvis-intent-stage/` then finalize without linting it, so ready-gate `lint:md` is the first reader of the run's own output (observed `MD012`/`MD038` on 2026-08-03 plan runs that entered gate repair and settled `completion_commit_failed`). Before either write step can gate on lint, a shared staged-path lint runner must exist. This subspec adds only that runner; the plan (01) and intent (02) write-step gates consume it.

## Decision ledger

- Add a staged-path markdownlint runner in the execution-loop surface (`v2/src/execution/`) that runs `markdownlint-cli2` over `*.md` under a given staging root only, with the same `.markdownlint-cli2.jsonc` config and rules as `bun run lint:md` — rules out a full-corpus `lint:md` during write and rules out v1-only or ready-gate-only enforcement.
- Non-autofix invocation; parse violations into `{ ruleId, filePath, message }` with repo-relative `filePath`; first violation wins on the recursive `*.md` walk (same convention as landing-contract reprompt tests) — rules out ad hoc violation shapes.
- Invocation failure (missing binary, non-zero tool error distinct from lint violations) fails closed — the runner reports a blocking error rather than reporting "clean" — rules out autofix-style fail-open that silently passes a broken linter.
- Reuse harness root resolution and config discovery from `shared/markdownlint-repair.ts` — rules out a second divergent config path.
- Out of scope: any write-loop wiring, reprompt surface, or budget handling (01/02); changes to the `lint:md` rule set.

## Prerequisites

- `bun run lint:md` runs markdownlint against paths governed by `.markdownlint-cli2.jsonc` (`package.json`, `shared/markdownlint-repair.ts`).

## Work

- Add `v2/src/execution/staged-markdown-lint.ts` exporting a runner (e.g. `lintStagedMarkdown(stagingRoot, deps?)`) that returns clean, a first-violation `{ ruleId, filePath, message }`, or a fail-closed invocation error.
- Add `v2/src/execution/staged-markdown-lint.test.ts` with committed `MD012`/`MD038` violation fixtures, a lint-clean fixture, and an invocation-failure injection.

## Acceptance criteria

- [ ] `staged-markdown-lint.test.ts` `reports the first violation with rule id and repo-relative path` stages an `MD012`-or-`MD038`-violating `*.md` under a staging root and asserts the runner returns `{ ruleId, filePath, message }`; fails against a stub that always reports clean.
- [ ] `staged-markdown-lint.test.ts` `reports clean staged Markdown as passing` asserts a lint-clean staging root returns no violation.
- [ ] `staged-markdown-lint.test.ts` `fails closed when the linter invocation errors` injects an invocation failure (missing binary / non-zero tool error) and asserts the runner returns a blocking error rather than clean.
- [ ] Mutation checkpoint: in `staged-markdown-lint.test.ts`, the test titled `fails closed when the linter invocation errors` carries a `// @mutate` directive (inside the test body) inverting the fail-closed guard so an invocation error reports clean; the mutation turns that test RED.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- None — operator-facing behavior ships with the plan (01) and intent (02) write-step gates.
