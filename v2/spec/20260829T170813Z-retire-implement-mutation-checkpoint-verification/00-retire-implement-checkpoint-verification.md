# Retire implement checkpoint verification

## Prerequisites

- Plan drafting, review, and normalization no longer require, author, or validate mutation/keystone checkpoint syntax (merged `retire-plan-mutation-checkpoint-authoring` spec); implement durable guidance deferred to this spec's documentation updates.

## Problem

- Implement completion still parses checkpoint-shaped criteria, applies authored `// @mutate` directives, and spends write iterations on guard, mutation-directive, and keystone reprompt repair for contracts plan drafting no longer authors or validates.

## Decision ledger

- Delete `mutation-checkpoint-verifier`, the three checkpoint reprompt prompts, and implement completion wiring rather than no-op stubs; rules out dormant revival of the retired DSL.
- Preserve diff-derived mutation verification, `write.mutation-repair`, scoped-test execution, repair budgets, and failure classes unchanged; rules out weakening the mechanical test-gap gate while removing authored checkpoints.
- `spec.criteria-ticked` on implement `done` / `no-work` checks only ordinary tick state; checkpoint-shaped bullet text is not selection or verification input; rules out legacy-tree checkpoint enforcement at completion.
- Remove unrestored-directive commit refusal and verify-run persistence with the verifier; stranded refusal only tracked verify-run apply/restore, so removing the verifier removes its producer; diff-derived verification at publication remains the mechanical mutation boundary and does not subsume stranded-mutation detection; rules out orphaned checkpoint-only commit guards with no apply/restore cycle.
- Leave checkpoint log event variants, `findDirectiveRepromptFromLog`, and daemon resume inputs untouched until the resume-replay spec; rules out coupling execution retirement to persistence and daemon cleanup here.
- Runtime smoke verification remains the shipped-no-op boundary; rules out reintroducing keystone headline-revert checks at implement completion.

## Tasks

- Filter checkpoint authoring lines from implement write step rules (mirror `filterPlanDraftStepRules`): wire `write-loop-input.ts` / `executeWrite` to inject filtered rules; update `write.test.ts` and `write-prompt.test.ts` pins that assert full `DEFAULT_WRITE_STEP_RULES` or checkpoint authoring language on implement prompts.
- Remove implement `spec.criteria-ticked` mutation-checkpoint verification from `v2/src/execution/write.ts`: drop `verifyMutationCheckpoints`, selector imports, reprompt eligibility helpers, guard/mutation/keystone reprompt prompt selection, and `mutationCheckpointSeams`; keep unticked-row and human-only handling unchanged.
- Remove implement completion checkpoint branches from `v2/src/execution/write-loop.ts`: drop `verifyMutationCheckpoints` calls, checkpoint reprompt emission (`guard_checkpoint_reprompt`, `mutation_directive_reprompt`, `keystone_directive_reprompt`), pending checkpoint reprompt context consumption in `executeWrite`, and `mutationCheckpointSeams` plumbing; do not edit daemon resume replay or log-stream event types in this change.
- Delete `v2/src/execution/mutation-checkpoint-verifier.ts`, `mutation-checkpoint-verifier.test.ts`, `mutation-checkpoint-keystone.test.ts`, and `v2/test/mutation-checkpoint-regression.test.ts`; remove their registry entries, prompt artifacts (`write.guard-checkpoint-reprompt`, `write.mutation-directive-reprompt`, `write.keystone-directive-reprompt`), and `write-prompt.test.ts` coverage for deleted prompts.
- Trim `shared/mutation-checkpoint-criteria.ts` to shared helpers still consumed outside implement verification (`acceptanceCriterionBlocks`, `isCheckpointTestFileReference` for premise-falsification); delete guard/keystone selectors and their tests when no production caller remains.
- Remove stranded-mutation / unrestored-directive imports from `v2/src/execution/completion-commit.ts` and update `completion-commit.test.ts` accordingly.
- Replace checkpoint-enforcement tests in `write.test.ts` and `write-loop.test.ts` with retirement pins; delete reprompt and hollow/unlinked checkpoint loop tests that only exercised the retired path.
- Align durable guidance listed below; remove implement checkpoint completion and repair-loop contracts while retaining diff-derived verification, mutation repair, guard-inversion evidence for source tests, and runtime smoke semantics.

## Acceptance criteria

- [x] `write.test.ts` test `checked checkpoint-shaped criteria complete without checkpoint verification` drives implement `spec.criteria-ticked` with ticked `Mutation checkpoint:` and `Keystone checkpoint:` bullets and proves completion on ordinary tick state only — no `contract_miss` from checkpoint selection, no directive apply/restore, and no checkpoint reprompt prompt id in the rendered write step; it fails against the pre-fix path reachable via `write.test.ts` test `ticked mutation-checkpoint criterion with no linked directive is a contract miss`.
- [x] `write-loop.test.ts` test `ticked hollow guard checkpoint settles without checkpoint reprompt` (or equivalent loop-level retirement pin) proves no `guard_checkpoint_reprompt`, `mutation_directive_reprompt`, or `keystone_directive_reprompt` log events and no checkpoint-driven `contract_miss` for formerly-repromptable hollow/unlinked misses; it fails against the pre-fix path reachable via `write-loop.test.ts` test `unlinked guard checkpoint reprompts before settle`.
- [x] `write.test.ts` test `patch.prompt.body resolves step placeholders and invokes binding` (updated) renders implement prompts whose final step-rules block omits checkpoint authoring lines (`comment checkpoint on the pinning test`, `Place \`// @mutate\``); it fails against pre-fix assertions in that test.
- [x] `completion-commit.test.ts` test `stranded replacement in staged content allows completion` (or equivalent) proves completion proceeds without unrestored-directive refusal; it fails against the pre-fix path reachable via `completion-commit.test.ts` test `stranded replacement in staged content refuses completion`.
- [x] `prompts/registry.txt` and `loadPromptRegistry()` expose no `write.guard-checkpoint-reprompt`, `write.mutation-directive-reprompt`, or `write.keystone-directive-reprompt` entry; reachable on main via `v2/src/execution/write-prompt.test.ts` and `prompts/write/guard-checkpoint-reprompt.md`.
- [x] `diff-derived-mutation-verifier.test.ts` stays green (behavior unchanged).
- [x] `write-loop.test.ts` test `returns surviving_mutation_failed when mutation verification detects an uncovered changed guard` stays green (mutation-repair gate unchanged).
- [x] `runtime-smoke-verifier.test.ts` stays green (runtime smoke semantics unchanged).
- [x] Durable docs carry no implement checkpoint verifier, directive, keystone, or pin-classifier completion contracts; diff-derived mutation verification and `write.mutation-repair` remain documented as the sole implement mutation gate; implement write prompts no longer inject checkpoint authoring guidance.
- [x] `bun run typecheck`, `bun run test:v1`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — remove implement checkpoint completion, reprompt pause/resume, and guard/mutation/keystone repair-loop contracts; retain diff-derived verification, mutation repair, and runtime smoke as the implement mutation boundary; document that implement write prompts omit checkpoint authoring step rules.
- `v2/docs/prompts.md` — remove the three checkpoint reprompt entries; retain `write.mutation-repair`.
- `v2/docs/test-writing.md` — remove implement checkpoint verifier, `@mutate` directive, keystone, and pin-classifier **completion** guidance; retain diff-derived mutation, guard-inversion evidence guidance for source tests, and premise-falsification guidance for `isCheckpointTestFileReference`.
- `v2/docs/workflow-runner.md` — remove implement checkpoint-repair behavior, implement guard-checkpoint repair-loop language, and the legacy-tree implement step-rules drain note; retain runtime smoke ordering and semantics.
- `v2/docs/v1-behaviors.md` — retire implement checkpoint machinery (guard/keystone verification and checkpoint reprompts) in favor of diff-derived-only implement completion behavior; update the plan-authoring drain note to reflect implement verification retirement.
- `v2/docs/operator-runbook.md` — remove implement-time selector, verifier, reprompt, stranded-mutation refusal, and drain-interval language from § Mutation checkpoints; retain diff-derived verification and mutation-repair operator guidance; resume-reconstruction bullets may remain cross-referenced for the follow-up resume-replay spec.
