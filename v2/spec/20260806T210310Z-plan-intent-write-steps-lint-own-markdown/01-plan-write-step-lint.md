# Plan write step lints staged Markdown before finalize

## Problem

The plan write step drafts Markdown under `.jarvis-plan-stage/` and finalizes without linting it, so ready-gate `lint:md` is the first reader of the plan's own output and goes red on the spec the run just wrote (2026-08-03 plan runs entered gate repair and settled `completion_commit_failed`). This subspec wires the staged-path lint runner (00) into the plan-draft finalize path.

## Prerequisites

- Subspec 00 landed: `lintStagedMarkdown` staged-path runner in `v2/src/execution/staged-markdown-lint.ts`.
- Plan write step stages Markdown under `.jarvis-plan-stage/` before plan-tree finalize (`write-loop.ts` `MARKDOWN_STAGING_ROOTS`, `write.test.ts`).
- The write loop reprompts within `maxIterations` on pre-finalization validation failures and settles `landing_failed` when the budget is exhausted (`write-loop.ts`, `write-loop-intent-landing.test.ts`).

## Decision ledger

- Run the 00 staged-path lint on the `plan.prompt.draft` `complete` outcome, before plan-tree finalize — rules out ready-gate `lint:md` as the first reader of plan Markdown.
- Clean staged Markdown finalizes with no extra agent invocation — rules out a second lint-only pass after a passing draft.
- On a violation, reprompt via a dedicated `write.staged-markdown-lint-reprompt` prompt (`RULE_ID`, `OFFENDING_FILE`, `STAGING_DIR` placeholders; violation text is the markdownlint message) and emit a `staged_markdown_lint_reprompt` log event — rules out reusing `write.landing-contract-reprompt` or implement-time template guesswork.
- Reprompt lifecycle mirrors the intent landing-contract reprompt: preserve stage bytes, progress the boundary before `continue`, resume replays from the log tail — rules out wiping the stage on a lint miss.
- Budget exhaustion on persistent lint violations settles `landing_failed` with `resumable: true` / `nextAction: "resume"` and preserved stage bytes — rules out terminal `contract_miss` on lint-only misses.
- Use a unique guard line for the plan-draft path as the `@mutate` anchor — rules out an ambiguous mutation target shared with the intent path (02).
- Out of scope: the intent write-step gate (02); gate-repair on lint failures that still reach the ready gate (`gate-repair-fence`); changes to the `lint:md` rule set.

## Work

- In `write-loop.ts`, evaluate the 00 lint runner on `plan.prompt.draft` `complete` before finalize; on violation reprompt within `maxIterations`; on budget exhaustion settle `landing_failed` resumable with stage preserved.
- Add `prompts/write/staged-markdown-lint-reprompt.md`, register `write.staged-markdown-lint-reprompt`, emit `staged_markdown_lint_reprompt`, and wire the reprompt into `write.ts` plan-draft path (preserve populated stage; inject reprompt prompt).
- Add `v2/src/execution/write-loop-staged-markdown-lint.test.ts` (plan cases) with committed lint-clean golden fixtures for the `MD012`/`MD038` rule families and violation fixtures.

## Acceptance criteria

- [ ] `write-loop-staged-markdown-lint.test.ts` `plan write step staged Markdown lint violation reprompts before finalize` drives a plan write with a staged `MD012`/`MD038` violation, asserts a reprompt carrying rule id and file path, asserts the loop `continue`s without terminal settlement on the first miss, and fails against pre-fix code that finalizes unconditionally.
- [ ] `write-loop-staged-markdown-lint.test.ts` `plan write step clean staged Markdown finalizes without extra invocation` asserts one agent invocation and finalize on clean staging; fails against pre-fix code if a second lint-only invocation runs.
- [ ] `write-loop-staged-markdown-lint.test.ts` `plan write step lint-clean MD012 and MD038 golden fixtures finalize without reprompt` drives plan writes with committed lint-clean fixtures covering the `MD012` and `MD038` rule families from the 2026-08-03 incidents and asserts finalize proceeds in one invocation.
- [ ] `write-loop-staged-markdown-lint.test.ts` `plan write step staged Markdown lint budget exhaustion settles landing_failed` drives a plan write that never fixes the violation through `maxIterations` and asserts `landing_failed` with `resumable: true` / `nextAction: "resume"` and preserved stage bytes (not `contract_miss`).
- [ ] `write-loop-staged-markdown-lint.test.ts` `plan write step staged Markdown lint reprompt preserves sibling stage files` drives a plan write where only one staged file violates lint and asserts sibling staged files under `.jarvis-plan-stage/` are byte-identical after the reprompt.
- [ ] Mutation checkpoint: in `write-loop-staged-markdown-lint.test.ts`, the test titled `plan write step staged Markdown lint violation reprompts before finalize` carries a `// @mutate` directive (inside the test body) on the plan-draft lint guard line in `write-loop.ts`; the mutation turns that test RED.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — plan write step lints staged Markdown before finalization; reprompt and budget-exhaustion semantics.
- `v2/docs/prompts.md` — document `write.staged-markdown-lint-reprompt` placeholders and usage.
- `v2/docs/v1-behaviors.md` — record the new pre-finalization lint gate for plan writes.
