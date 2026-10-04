---
name: plan-intent-write-steps-lint-own-markdown
---

# Plan and intent write steps lint staged Markdown before finalization

The fix touches one module-boundary surface (execution loop), so splitting does not apply: plan and intent write steps share the same pre-finalization staging seam in the write loop.

## Problem

The plan write step drafts Markdown and finalizes without ever linting it. `lint:md` then runs in the ready gate and goes red on the spec the run just wrote — the gate is the first thing that reads the plan's own output. Two plan runs on 2026-08-03, same session: `f225849b` → `5fd45995` (`tui-command-editor` 00, `MD012` × 1) and `77b741af` → `080e3d64` (`tui-command-dispatch` 02, `MD038` × 4). Both entered gate repair, both settled `completion_commit_failed`, both cost a hand-finish. The intent write step drafts Markdown on the identical seam.

## Decisions

- Plan write step lints staged Markdown before finalization and reprompts on failure with rule and location — rules out the ready gate being the first reader of plan Markdown.
- Intent write step enforces the same contract on `.jarvis-intent-stage/` output — rules out plan-only or intent-only coverage.
- Pre-finalization lint runs `markdownlint-cli2` on staged paths only with the same `.markdownlint-cli2.jsonc` config and rules as `bun run lint:md` — rules out a full-corpus `lint:md` invocation during plan/intent write.
- Clean staged Markdown finalizes with no extra agent invocation — rules out a second lint-only pass after a passing draft.
- Reprompt carries configured `lint:md` rule id and file location — rules out a generic contract-miss without actionable lint coordinates.
- When staged Markdown lint violations persist through `maxIterations`, write loop settles `landing_failed` with `resumable: true` / `nextAction: "resume"` and preserved stage bytes — mirrors intent landing-contract budget exhaustion; rules out terminal `contract_miss` on lint-only misses.
- Out of scope: gate-repair on lint failures that still reach the ready gate (`gate-repair-fence`) and changes to the `lint:md` rule set.

## Acceptance criteria

- [ ] `write-loop-staged-markdown-lint.test.ts` `plan write step staged Markdown lint violation reprompts before finalize` drives a plan write with staged `MD012` or `MD038` violation, asserts a reprompt carrying rule id and file path, asserts the loop `continue`s without terminal settlement on the first miss, and fails against pre-fix code that finalizes unconditionally.
- [ ] `write-loop-staged-markdown-lint.test.ts` `plan write step clean staged Markdown finalizes without extra invocation` asserts one agent invocation and finalize on clean staging; fails against pre-fix code if a second lint-only invocation runs.
- [ ] `write-loop-staged-markdown-lint.test.ts` `intent write step staged Markdown lint violation reprompts before finalize` drives an intent write with staged lint violation, asserts reprompt with rule id and file path before finalize, and fails against pre-fix code that finalizes unconditionally.
- [ ] `write-loop-staged-markdown-lint.test.ts` `plan write step MD012 and MD038 staged fixtures pass lint gate before finalize` drives plan write with committed multiple-blanks (`MD012`) and spaces-in-code-span (`MD038`) staged fixtures, asserts pre-finalization lint passes and finalize proceeds without ready-gate `lint:md` repair; fails against pre-fix code that lands dirty staging.
- [ ] Skipping the staged-Markdown lint guard turns `plan write step staged Markdown lint violation reprompts before finalize` RED; `write-loop-staged-markdown-lint.test.ts` names that mutation checkpoint.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/workflow-runner.md` — plan and intent write steps lint their staged Markdown before finalization.

## Prerequisites

- Plan and intent write steps stage Markdown under `.jarvis-plan-stage/` and `.jarvis-intent-stage/` respectively before finalization or landing.
- `bun run lint:md` runs markdownlint against paths governed by `.markdownlint-cli2.jsonc`; staged-path lint reuses that config and rule set.
- The write loop reprompts the agent within `maxIterations` on pre-finalization validation failures (e.g. intent landing-contract violations) and settles `landing_failed` when the budget is exhausted.
