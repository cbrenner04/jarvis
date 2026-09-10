# Prompts

The prompt corpus lives under `prompts/` and is indexed by `prompts/registry.txt`; `shared/prompts/registry.ts` loads every listed artifact at startup and rejects unknown ids at render time. Each artifact is a Markdown file whose frontmatter declares its `id`, `behavior`, `kind` (`step` or `fragment`), `revision`, `placeholders`, and the fragment directives below. Frontmatter keys, placeholder syntax, delimiter policy, and the validation boundary are owned by [`prompt-governance.md`](./prompt-governance.md); placement of prompt prose versus docs is owned by [`documentation-standard.md`](./documentation-standard.md). This document is the operator map: which id renders where, through which path, with which fragments.

## Fragment frontmatter contract

A `fragment` artifact is prose prepended to step prompts; a `step` artifact is the prompt body itself. Inclusion is declared, never hand-rolled by callers:

- `fragmentPolicy:` — required on every `step`, forbidden on fragments: `global` prepends the ranked global fragments, `behavior` prepends globals then the step's lane, `none` prepends nothing; `add`/`remove` apply after the policy in every case. Registry load fails on a missing or unknown value.
- `behavior:` — the lane an artifact belongs to. Fragments with `behavior: global` (`global.documentation`, `global.naming`, `global.terse`, `global.no-hard-wrap`, ranked by `order:`) prepend to every step; fragments whose `behavior` matches the step's `behavior` prepend after the globals. Lanes today: `global`, `plan` (fragments `plan.decisions-ledger`, `plan.defer-to-consumer`), `write` (fragment `write.principles`), `intent`, `implement`, `patch`. `implement.rules` (`behavior: implement-rules`) and `shared.pr-description` (`behavior: shared-pr-description`) deliberately sit on lanes no step declares, so they attach only where named.
- `add:` — extra fragment ids appended after the lane fragments (`plan.prompt.pr-description` and `patch.prompt.pr-description` add `shared.pr-description`).
- `remove:` — fragment ids excluded for this step (every intent and plan review role removes `global.naming`; `patch.prompt.shrink` removes `global.documentation` and `global.naming`).
- `order:` — rank within a lane; unranked fragments sort last by id.

The lane label is load-bearing: `intent.prompt.split` carries `behavior: intent` (a lane with no fragments) precisely so it does not inherit the plan fragments, and `implement/review-*.md` carry `behavior: implement` for the same reason.

## Render path

One assembler serves every engine: `renderPromptForStep` in `shared/prompts/assemble.ts`. It assembles the step template per the artifact's declared `fragmentPolicy`, then `renderArtifactTemplate` (`shared/prompts/render.ts`) applies variants, optional sections, and placeholder substitution, and the result is trimmed. Every step-prompt call site — the shared builders (`plan-draft.ts`, `intent-split.ts`, `review-plan.ts`, `review-intent.ts`, `review-implement.ts`) and the v2 write loop (`write.ts`, `write-loop.ts`, `step-runner.ts`, `reviewed-staged-markdown-lint.ts`) — reaches it; `step-prompt-dispatch-guard.test.ts` fails when production code outside the assembler calls `assemblePromptForStep`, `renderStepPrompt`, or bare `renderArtifactTemplate`, and `cross-path-render.test.ts` proves every registered step assembles exactly as its policy declares. `executeWrite` resolves the step-owned placeholders (`REPO_GUIDANCE`, `ACTIVE_SUBSPEC_*`, `PATCH_RULES`, `STEP_RULES`, `SPEC_GUIDANCE`) before invocation; see [`write-behavior.md § Write-step prompt placeholders`](./write-behavior.md#write-step-prompt-placeholders).

Declared policies: `plan.prompt.*` (draft, review roles, review-actuator, pr-description) are `behavior`; `write.execute` is `global` with `PRINCIPLES` carrying `write.principles` (never duplicated by assembly); `implement.prompt.body`, `patch.prompt.shrink`, every intent, implement, and patch review role, `intent.prompt.split`, `write.ready-repair`, and `write.mutation-repair` are `global`; the reprompts (`write.token-reprompt`, `write.blocker-reprompt`, `write.landing-contract-reprompt`, `write.staged-markdown-lint-reprompt`, `write.surviving-mutation-reprompt`, `write.coverage-advisory`) are `none`.

## Per-workflow step prompts

### Implement

- `implement.prompt.body` (`prompts/implement/instructions.md`, `behavior: implement`) — the implement write step, pinned by the `implement` preset (`WORKFLOW_PRESET_PINNED_FIELDS` in `workflow-runner.ts`) and by `implement-workflow-steps.ts`. Placeholders: `SPEC_PATH`, `SIBLINGS_BLOCK`, `REPO_GUIDANCE`, `ACTIVE_SUBSPEC_PATH`, `ACTIVE_SUBSPEC_BODY`, `PATCH_RULES`, `TIMEOUT_CHECKPOINT_CONTEXT`, `STEP_RULES`; the repo-guidance, active-subspec, and timeout-checkpoint blocks are optional sections that vanish when their placeholder is empty. Implement-only branching in the write loop (criteria-ticked completion contract, blocker-text contract, in-loop mutation verification, coverage advisory, checkpoint subjects) keys on this id.
- `implement.rules` (`prompts/implement/rules.md`, fragment) — the target-repo-neutral rules injected through the `PATCH_RULES` placeholder (the key survived the id migration from `patch.rules`). Rules that only apply to this repository (serial `bun test` re-run, injected machine-config fixtures, timer-callback guard extraction) live in `AGENTS.md`, which reaches the agent as `REPO_GUIDANCE`.
- `patch.prompt.shrink` (`prompts/patch/shrink.md`, `behavior: patch`) — the post-completion shrink step; layers `global.terse` and `global.no-hard-wrap` only.
- `patch.prompt.pr-description` — implement PR-body narrative step; see [`workflow-runner.md § Implement PR body template`](./workflow-runner.md#implement-pr-body-template).

`write.execute` (`prompts/write/execute.md`, `behavior: write`) is **not** the implement prompt: it is the default only for a standalone `jarvis run start` write loop with no workflow, injecting `SPEC_PATH`, `PRINCIPLES` (`write.principles`), and `STEP_RULES`.

### Plan

- `plan.prompt.draft` — pinned by the `plan` preset; placeholders `WORKDIR`, `NAME`, `INTENT`, `SPEC_GUIDANCE`, `TARGET_DIR`; variants `flat-layout` / `nested-target-dir` select the spec-path layout. Rules carry step mechanics only; authoring norms come from the injected [`spec-guidance-agent-core.md`](./spec-guidance-agent-core.md). See [`write-behavior.md § Plan write-step seeding`](./write-behavior.md#plan-write-step-seeding-and-completion-contract).
- `plan.prompt.review-actuator` — verdict-application step (same variants as the draft) plus injected `SPEC_GUIDANCE`.
- `plan.prompt.pr-description` — plan PR-body step, adds `shared.pr-description`.

### Intent

- `intent.prompt.split` — pinned by the `intent` preset; placeholders `WORKDIR`, `SEED_LABEL`, `SEED_CONTENT`; no `SPEC_GUIDANCE` injection (the prompt directs the agent to read the agent core for sizing). Landing-shape violations reprompt via `write.landing-contract-reprompt`; see [`write-behavior.md § Intent split landing contracts`](./write-behavior.md#intent-split-landing-contracts).
- `intent.prompt.review` / `intent.prompt.review-actuator` — light review critic and actuator over the staged ready-intent (`STAGED_INTENT`, `SPEC_GUIDANCE`, `VERDICT_PATH` / `VERDICT`).

### Write-loop reprompts

| Id | Trigger | Placeholders | Home |
| --- | --- | --- | --- |
| `write.token-reprompt` | first response carries no terminal token | `RESPONSE_TEXT` | [`write-behavior.md § Terminal token`](./write-behavior.md#terminal-token) |
| `write.blocker-reprompt` | `blocked` misses the blocker-text contract | none | same |
| `write.landing-contract-reprompt` | intent-split staged output fails landing shape | `VIOLATION`, `OFFENDING_FILE`, `STAGING_DIR` | [§ Intent split landing contracts](./write-behavior.md#intent-split-landing-contracts) |
| `write.staged-markdown-lint-reprompt` | staged plan/intent Markdown fails markdownlint | `RULE_ID`, `VIOLATION`, `OFFENDING_FILE`, `STAGING_DIR` | [`workflow-runner.md § Review dispatch`](./workflow-runner.md#review-dispatch) |
| `write.ready-repair` | ready gate fails at publication | `SPEC_PATH`, `STEP_RULES`, `GATE_COMMAND`, `GATE_EXIT_CODE`, `GATE_OUTPUT` | [`workflow-runner.md § Ready gate repair`](./workflow-runner.md#ready-gate-repair) |
| `write.surviving-mutation-reprompt` | in-loop diff-derived verification finds an uncovered guard | `SPEC_PATH`, `STEP_RULES`, `SURVIVING_MUTATION`, `SOURCE_FILE`, `SOURCE_LINE`, `DUAL_CONSTRAINT_DETAIL` | [§ Diff-derived mutation verification](./write-behavior.md#diff-derived-mutation-verification) |
| `write.mutation-repair` | publication-time confirm-only verification finds a repair-introduced survivor | same as above | same |
| `write.coverage-advisory` | implement completes with uncovered changed lines (deliver-only) | `COVERAGE_REPORT` | [§ Coverage advisory](./write-behavior.md#coverage-advisory) |

## Review-role families

Four families share one terse skeleton — a role header, bare data blocks (the staged document or spec tree, the diff, the prior role's output), and a short `Rules` list — and one domain policy (`shared/prompts/review-profile.ts`: verdict source, empty-verdict stop, read-only critic / writing actuator).

| Family | Ids | Renderer | Status |
| --- | --- | --- | --- |
| plan | `plan.prompt.review.critic`, `.adversary`, `.advocate`, `.adjudicator`, `plan.prompt.review-actuator` | `shared/prompts/review-plan.ts` | converged to the intent-family style |
| implement | `implement.prompt.review.critic`, `.adversary`, `.advocate`, `.adjudicator` (`behavior: implement`); actuator renders `implement.prompt.body` with a verdict preamble | `shared/prompts/review-implement.ts` | converged to the intent-family style; `BRANCH_DIFF` is the merge-base unified diff |
| intent | `intent.prompt.review`, `intent.prompt.review-actuator`, `intent.prompt.review.adversary`, `.advocate`, `.adjudicator` | `shared/prompts/review-intent.ts` | the reference style |
| patch | `patch.prompt.review.adversary`, `.advocate`, `.adjudicator` | none in v2 | **frozen** with the retired v1 engine; summary-only `BRANCH_DIFF` |

Light review runs critic then actuator; debate review runs adversary → advocate → adjudicator, whose verdict drives the actuator (`REVIEW_PASS_NUMBER` / `REVIEW_PASS_CONTEXT` thread passes). Dispatch, verdict persistence, and landing are in [`workflow-runner.md § Review dispatch`](./workflow-runner.md#review-dispatch) and [`write-behavior.md § Review cycle`](./write-behavior.md#review-cycle); per-role placeholder tables are pinned by the registry and render tests, not repeated here.

## Ownership and change discipline

- A registered artifact change needs render coverage: `shared/prompts/render-observer-tests.ts` maps each `prompts/**` path to the tests that render it through its production renderer, and ready finalization fails with `missing-render-coverage` otherwise ([`test-writing.md § Prompt changes`](./test-writing.md#prompt-changes)).
- Bump `revision` on every prose change; the growth-budget and contract-preservation tests under `shared/prompts/` bound review-role drift.
- Post-render string surgery on assembled prompts is forbidden (`shared/prompts/no-prompt-surgery-guard.ts`); express layout differences as variants.

## Variants and optional sections

Artifacts may declare `variants` and `optionalSections` as single-line JSON frontmatter values (absent keys default to `{}` and `[]`).

- `variants` — object mapping a variant id to an ordered array of `{ "anchor", "replacement", "replaceAll"? }`; reserved plan ids are `flat-layout` and `nested-target-dir`.
- `optionalSections` — array of `{ "header", "begin", "end", "placeholder" }`; each `placeholder` must be declared in `placeholders`.

Registry load rejects malformed shapes (non-object `variants`, empty ids, non-array entries, missing `anchor`/`replacement`, non-boolean `replaceAll`, undeclared section placeholders). `renderArtifactTemplate` runs in order: variant substitution (first match unless `replaceAll`), optional-section excision from `header` through `end` when the bound value is empty or whitespace (`begin` is a positional validator only), then placeholder substitution. `PromptRenderingError` reasons `unknown_variant` and `missing_template_anchor` fail loudly on prose drift; the remaining reasons are listed in [`prompt-governance.md § Validation boundary`](./prompt-governance.md#validation-boundary).
