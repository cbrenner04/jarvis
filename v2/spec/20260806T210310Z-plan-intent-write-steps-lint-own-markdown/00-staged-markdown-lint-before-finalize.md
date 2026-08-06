# Staged Markdown lint before finalize

Plan and intent write steps stage Markdown under `.jarvis-plan-stage/` and `.jarvis-intent-stage/` then finalize without linting it. Ready-gate `lint:md` is the first reader and goes red on the run's own output — observed `MD012` and `MD038` on 2026-08-03 plan runs that entered gate repair and settled `completion_commit_failed`.

## Decision ledger

- Pre-finalization lint on `intent.prompt.split` and `plan.prompt.draft` `complete` outcomes, before landing or plan-tree finalize — rules out ready-gate `lint:md` as the first reader of staged plan/intent Markdown.
- Lint invocation runs `markdownlint-cli2` on staged `*.md` paths only with `.markdownlint-cli2.jsonc` (same config and rules as `bun run lint:md`) — rules out full-corpus `lint:md` during write.
- Clean staged Markdown finalizes with no extra agent invocation — rules out a second lint-only pass after a passing draft.
- Reprompt carries rule id and file path from lint output — rules out a generic contract-miss without actionable coordinates.
- Dedicated reprompt surface: new `write.staged-markdown-lint-reprompt` prompt (`RULE_ID`, `OFFENDING_FILE`, `STAGING_DIR` placeholders; violation text is the markdownlint message) and `staged_markdown_lint_reprompt` log event — rules out reusing `write.landing-contract-reprompt` or implement-time template guesswork.
- Reprompt lifecycle mirrors intent landing-contract reprompt: preserve stage bytes, progress boundary before `continue`, resume replay from log tail — rules out wiping stage on lint miss.
- On `intent.prompt.split`, landing-contract and staged-Markdown lint share `maxIterations` and one reprompt slot per iteration; landing-contract is evaluated first; at most one reprompt per iteration — rules out double reprompt or independent budgets.
- Violation selection: recursive `*.md` under the staging root; first violation wins (same convention as landing-contract reprompt tests); offending-file path is repo-relative — rules out ad hoc path shapes.
- Budget exhaustion on persistent lint violations settles `landing_failed` with `resumable: true` / `nextAction: "resume"` and preserved stage bytes — rules out terminal `contract_miss` on lint-only misses.
- Staged-path lint helper lives in execution loop surface (`v2/src/execution/`) — rules out v1-only or ready-gate-only enforcement.
- Pre-finalization lint invocation failures (missing binary, non-zero tool error) fail closed in production paths — rules out autofix-style fail-open that silently passes a broken linter.
- Gate-repair on lint failures that still reach the ready gate (`gate-repair-fence`) — out of scope.
- Changes to the `lint:md` rule set — out of scope.

## Prerequisites

- Plan and intent write steps stage Markdown under `.jarvis-plan-stage/` and `.jarvis-intent-stage/` respectively before finalization or landing (`write-loop.ts` `MARKDOWN_STAGING_ROOTS`, `write.test.ts`, `write-loop-intent-landing.test.ts`).
- `bun run lint:md` runs markdownlint against paths governed by `.markdownlint-cli2.jsonc` (`package.json`, `shared/markdownlint-repair.ts`).
- The write loop reprompts within `maxIterations` on pre-finalization validation failures and settles `landing_failed` when the budget is exhausted (`write-loop.ts`, `write-loop-intent-landing.test.ts`).

## Work

- Add staged-path markdownlint runner (non-autofix) reusing harness root resolution and `.markdownlint-cli2.jsonc` from `shared/markdownlint-repair.ts`; parse violations into rule id, file path, and display text; fail closed on invocation errors.
- In `write-loop.ts`, evaluate staged Markdown lint on `complete` for `intent.prompt.split` (after landing-contract gate passes) and `plan.prompt.draft` (before plan-tree finalize); on violation reprompt within shared `maxIterations`; on budget exhaustion settle `landing_failed` resumable with stage preserved. Use a unique guard line per path as `@mutate` anchor (plan draft vs intent split).
- Add `prompts/write/staged-markdown-lint-reprompt.md`, register `write.staged-markdown-lint-reprompt`; emit `staged_markdown_lint_reprompt` log events; wire reprompt into `write.ts` plan-draft and intent-split paths (preserve populated stage; inject reprompt prompt).
- Add `v2/src/execution/write-loop-staged-markdown-lint.test.ts` with committed lint-clean golden fixtures for the `MD012`/`MD038` rule families, violation fixtures for reprompt paths (`MD012`/`MD038` on plan; `MD038` on intent — survives intent autofix), and clean staging helpers.
- Update `v2/docs/workflow-runner.md`, `v2/docs/v1-behaviors.md`, and `v2/docs/prompts.md`.

## Acceptance criteria

- [ ] `write-loop-staged-markdown-lint.test.ts` `plan write step staged Markdown lint violation reprompts before finalize` drives a plan write with staged `MD012` or `MD038` violation, asserts a reprompt carrying rule id and file path, asserts the loop `continue`s without terminal settlement on the first miss, and fails against pre-fix code that finalizes unconditionally.
- [ ] `write-loop-staged-markdown-lint.test.ts` `plan write step clean staged Markdown finalizes without extra invocation` asserts one agent invocation and finalize on clean staging; fails against pre-fix code if a second lint-only invocation runs.
- [ ] `write-loop-staged-markdown-lint.test.ts` `intent write step clean staged Markdown finalizes without extra invocation` asserts one agent invocation and finalize on clean intent staging; fails against pre-fix code if a second lint-only invocation runs.
- [ ] `write-loop-staged-markdown-lint.test.ts` `intent write step staged Markdown lint violation reprompts before finalize` drives an intent write with staged `MD038` violation (post-autofix state; `MD012` is not a valid fixture here), asserts reprompt with rule id and file path before finalize, and fails against pre-fix code that finalizes unconditionally.
- [ ] `write-loop-staged-markdown-lint.test.ts` `plan write step lint-clean MD012 and MD038 golden fixtures finalize without reprompt` drives plan write with committed lint-clean staged fixtures covering the `MD012` and `MD038` rule families from the 2026-08-03 incidents, asserts pre-finalization lint passes and finalize proceeds in one invocation; fails against pre-fix code that finalizes without the lint gate.
- [ ] `write-loop-staged-markdown-lint.test.ts` `plan write step staged Markdown lint budget exhaustion settles landing_failed` drives a plan write that never fixes staged lint violations through `maxIterations`, asserts `landing_failed` with `resumable: true` / `nextAction: "resume"` and preserved stage bytes (not `contract_miss`); fails against pre-fix code that settles terminal `contract_miss` or drops stage.
- [ ] `write-loop-staged-markdown-lint.test.ts` `plan write step staged Markdown lint reprompt preserves sibling stage files` drives a plan write where only one staged file violates lint, asserts reprompt fires, and asserts sibling staged files (e.g. `intent.md` or another `*.md` under `.jarvis-plan-stage/`) are byte-identical after reprompt; fails against pre-fix code that re-seeds or wipes the stage.
- [ ] Skipping the plan staged-Markdown lint guard turns `plan write step staged Markdown lint violation reprompts before finalize` RED; `write-loop-staged-markdown-lint.test.ts` names that mutation checkpoint with a stable `@mutate` anchor on the plan-draft guard line in `write-loop.ts`.
- [ ] Skipping the intent staged-Markdown lint guard turns `intent write step staged Markdown lint violation reprompts before finalize` RED; `write-loop-staged-markdown-lint.test.ts` names that mutation checkpoint with a stable `@mutate` anchor on the intent-split guard line in `write-loop.ts`.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — plan and intent write steps lint staged Markdown before finalization; reprompt and budget-exhaustion semantics.
- `v2/docs/v1-behaviors.md` — record the new pre-finalization lint gate for plan and intent writes.
- `v2/docs/prompts.md` — document `write.staged-markdown-lint-reprompt` placeholders and usage.
