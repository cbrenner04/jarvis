# Staged Markdown lint before finalize

Plan and intent write steps stage Markdown under `.jarvis-plan-stage/` and `.jarvis-intent-stage/` then finalize without linting it. Ready-gate `lint:md` is the first reader and goes red on the run's own output — observed `MD012` and `MD038` on 2026-08-03 plan runs that entered gate repair and settled `completion_commit_failed`.

## Decision ledger

- Pre-finalization lint on `intent.prompt.split` and `plan.prompt.draft` `complete` outcomes, before landing or plan-tree finalize — rules out ready-gate `lint:md` as the first reader of staged plan/intent Markdown.
- Lint invocation runs `markdownlint-cli2` on staged `*.md` paths only with `.markdownlint-cli2.jsonc` (same config and rules as `bun run lint:md`) — rules out full-corpus `lint:md` during write.
- Clean staged Markdown finalizes with no extra agent invocation — rules out a second lint-only pass after a passing draft.
- Reprompt carries rule id and file path from lint output — rules out a generic contract-miss without actionable coordinates.
- Reprompt lifecycle mirrors intent landing-contract reprompt: preserve stage bytes, `landing_contract_reprompt` log event (or equivalent fields), `write.landing-contract-reprompt` template with violation text carrying rule id and path, progress boundary before `continue`, resume replay from log tail — rules out wiping stage on lint miss.
- Budget exhaustion on persistent lint violations settles `landing_failed` with `resumable: true` / `nextAction: "resume"` and preserved stage bytes — rules out terminal `contract_miss` on lint-only misses.
- Staged-path lint helper lives in execution loop surface (`v2/src/execution/`) — rules out v1-only or ready-gate-only enforcement.
- Gate-repair on lint failures that still reach the ready gate (`gate-repair-fence`) — out of scope.
- Changes to the `lint:md` rule set — out of scope.

## Prerequisites

- Plan and intent write steps stage Markdown under `.jarvis-plan-stage/` and `.jarvis-intent-stage/` respectively before finalization or landing (`write-loop.ts` `MARKDOWN_STAGING_ROOTS`, `write.test.ts`, `write-loop-intent-landing.test.ts`).
- `bun run lint:md` runs markdownlint against paths governed by `.markdownlint-cli2.jsonc` (`package.json`, `shared/markdownlint-repair.ts`).
- The write loop reprompts within `maxIterations` on pre-finalization validation failures and settles `landing_failed` when the budget is exhausted (`write-loop.ts`, `write-loop-intent-landing.test.ts`).

## Work

- Add staged-path markdownlint runner (non-autofix) reusing harness root resolution and `.markdownlint-cli2.jsonc` from `shared/markdownlint-repair.ts`; parse violations into rule id, file path, and display text.
- In `write-loop.ts`, evaluate staged Markdown lint on `complete` for `intent.prompt.split` (after existing landing-contract gate passes) and `plan.prompt.draft` (before plan-tree finalize); on violation reprompt within `maxIterations`; on budget exhaustion settle `landing_failed` resumable with stage preserved.
- Wire reprompt into `write.ts` plan-draft and intent-split paths (preserve populated stage; inject reprompt prompt).
- Add `v2/src/execution/write-loop-staged-markdown-lint.test.ts` with committed `MD012` / `MD038` violation fixtures and clean plan-draft staging helpers.
- Update `v2/docs/workflow-runner.md`.

## Acceptance criteria

- [ ] `write-loop-staged-markdown-lint.test.ts` `plan write step staged Markdown lint violation reprompts before finalize` drives a plan write with staged `MD012` or `MD038` violation, asserts a reprompt carrying rule id and file path, asserts the loop `continue`s without terminal settlement on the first miss, and fails against pre-fix code that finalizes unconditionally.
- [ ] `write-loop-staged-markdown-lint.test.ts` `plan write step clean staged Markdown finalizes without extra invocation` asserts one agent invocation and finalize on clean staging; fails against pre-fix code if a second lint-only invocation runs.
- [ ] `write-loop-staged-markdown-lint.test.ts` `intent write step staged Markdown lint violation reprompts before finalize` drives an intent write with staged lint violation, asserts reprompt with rule id and file path before finalize, and fails against pre-fix code that finalizes unconditionally.
- [ ] `write-loop-staged-markdown-lint.test.ts` `plan write step MD012 and MD038 staged fixtures pass lint gate before finalize` drives plan write with committed multiple-blanks (`MD012`) and spaces-in-code-span (`MD038`) staged fixtures, asserts pre-finalization lint passes and finalize proceeds without ready-gate `lint:md` repair; fails against pre-fix code that lands dirty staging.
- [ ] Skipping the staged-Markdown lint guard turns `plan write step staged Markdown lint violation reprompts before finalize` RED; `write-loop-staged-markdown-lint.test.ts` names that mutation checkpoint.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — plan and intent write steps lint their staged Markdown before finalization.
