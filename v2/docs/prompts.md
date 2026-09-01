# Prompts

Registered prompts are artifacts with stable IDs and versions, living in the `prompts/` directory and indexed via `prompts/registry.txt`. Each prompt serves one or more roles and workflows. This doc captures registry-level entries and their usage scope. Frontmatter keys, placeholder contracts, and delimiter policy are indexed in [`v1/docs/prompt-governance.md`](../../v1/docs/prompt-governance.md); variant and optional-section contracts below are the v2 durable home for those keys.

## Variants and optionalSections

Prompt artifacts may declare `variants` and `optionalSections` as single-line JSON frontmatter values (parsed in `shared/prompts/registry.ts`). Absent keys default to `{}` and `[]`.

### Frontmatter shapes

- `variants` — JSON object mapping variant id to an ordered array of `{ "anchor": string, "replacement": string, "replaceAll"?: boolean }`. Variant ids are non-empty strings.
- `optionalSections` — JSON array of `{ "header": string, "begin": string, "end": string, "placeholder": string }`. Each `placeholder` must name a placeholder declared in the artifact `placeholders` frontmatter (`NAME:string` or `NAME:string!`).

### Registry load-time validation

Malformed JSON for either key fails registry load. Structural rejects at load time:

- `variants` is not a plain object, any variant id is empty, any variant entry is not an array, or any substitution object lacks string `anchor`/`replacement` or has non-boolean `replaceAll`.
- `optionalSections` is not an array, any entry is not a plain object, or any entry lacks string `header`/`begin`/`end`/`placeholder`.
- Any `optionalSections[].placeholder` is not declared in `placeholders`.

### Render pipeline (`renderArtifactTemplate`)

Resolution runs on whatever `artifact.body` the caller passes (assembled or on-disk body). Order:

1. **Variant selection** — when `options.variant` is set, apply that variant's substitution array to the body in array order, each entry on the evolving string. Omitted `options.variant` is a no-op even when `variants` is populated. `replaceAll` omitted substitutes the first `anchor` match only (`String.prototype.replace`); `replaceAll: true` uses `replaceAll`.
2. **Optional-section omission** — for each `optionalSections` entry, when the bound placeholder value is empty (`undefined`, `null`, `""`, or whitespace-only string; non-string values coerce to `""` before the test), excise from the first `header` occurrence through the matching `end` inclusive, then consume trailing `\n` characters. `begin` is a positional validator: it must appear after `header` and before `end`, but excision starts at `header`, not `begin`. Non-empty bound values leave the section intact for normal placeholder substitution.
3. **Placeholder substitution** — `renderTemplateWithDeclarations` on the post-variant, post-excision body.

### Reserved plan variant ids

- `flat-layout` — flat spec-path layout for plan draft and plan review prompts.
- `nested-target-dir` — nested `targetDir` spec-path layout for plan draft and plan review prompts.

Migration of call sites from post-render string surgery to these ids is scoped in [`v2/spec/ready-intents/eliminate-prompt-string-surgery.md`](../spec/ready-intents/eliminate-prompt-string-surgery.md).

### Render-time anchor errors (`PromptRenderingError`)

- `unknown_variant` — `options.variant` names an id absent from `artifact.metadata.variants`.
- `missing_template_anchor` — a variant `anchor` or optional-section `header`/`begin`/`end` is absent from the template body before substitution or excision. No silent no-op on prompt prose drift.

Other `PromptRenderingError` reasons (`unknown_placeholder`, `missing_value`, `type_mismatch`, `invalid_placeholder_pattern`, `delimiter_violation`) are covered in [`v1/docs/prompt-governance.md`](../../v1/docs/prompt-governance.md#validation-boundary).

## Write-step prompts

### `write.execute`

Default write-step prompt for plan, implement, and standalone write. Injects `SPEC_PATH`, `STEP_RULES`, `PRINCIPLES`, `REPO_GUIDANCE`, and `ACTIVE_SUBSPEC_BODY`. See [`write-behavior.md`](./write-behavior.md#write-step-prompt-placeholders).

### `write.token-reprompt`

One-shot re-prompt issued when the agent's first response carries no terminal token (`done`, `no-work`, `blocked`, `progress`). Injects `RESPONSE_TEXT` (the first response). Used by the step runner; see [`write-behavior.md`](./write-behavior.md#terminal-token).

### `write.blocker-reprompt`

One-shot re-prompt issued when a `blocked` token misses the blocker-text contract. No placeholders. Used by the step runner; see [`write-behavior.md`](./write-behavior.md#terminal-token).

### `write.landing-contract-reprompt`

Re-prompt issued when `intent.prompt.split` staged output fails landing-shape validation before write-loop completion. Injects `VIOLATION`, `OFFENDING_FILE`, and `STAGING_DIR`. Used by the write loop; see [`write-behavior.md`](./write-behavior.md#intent-split-landing-contracts).

### `write.staged-markdown-lint-reprompt`

Re-prompt issued when staged plan or intent Markdown fails markdownlint before write-loop completion or before review actuator landing. Injects `RULE_ID`, `VIOLATION` (markdownlint message), `OFFENDING_FILE`, and `STAGING_DIR`. Used by the write loop and the review completion seam (`landReviewedOutputOrFail`, `finishReviewedLanding`); see [`workflow-runner.md`](./workflow-runner.md#review-dispatch) and [`write-behavior.md`](./write-behavior.md#intent-review-cycle).

### `write.ready-repair`

Re-prompt issued when the ready gate fails during completion publication. Injects `SPEC_PATH`, `STEP_RULES`, `GATE_COMMAND`, `GATE_EXIT_CODE`, and `GATE_OUTPUT`. Used by the write loop's publication boundary; see [`write-behavior.md`](./write-behavior.md#ready-finalization).

### `write.surviving-mutation-reprompt`

Re-prompt issued when in-loop diff-derived mutation verification finds an uncovered changed guard on an implement `done`/`no-work` iteration before completion commit or publication. Injects `SPEC_PATH`, `STEP_RULES`, `SURVIVING_MUTATION`, `SOURCE_FILE`, `SOURCE_LINE`, and `DUAL_CONSTRAINT_DETAIL` (same names as `write.mutation-repair`). Used by the implement write loop; see [`write-behavior.md`](./write-behavior.md#diff-derived-mutation-verification).

### `write.mutation-repair`

Re-prompt issued when publication-time confirm-only mutation verification finds a repair-introduced surviving mutation after in-loop verification already passed. Injects `SPEC_PATH`, `STEP_RULES`, `SURVIVING_MUTATION`, `SOURCE_FILE`, `SOURCE_LINE`, and `DUAL_CONSTRAINT_DETAIL`. Used by implement-initiated recovery at publication; see [`write-behavior.md`](./write-behavior.md#diff-derived-mutation-verification).

### `write.coverage-advisory`

Advisory re-prompt issued after a completing implement write when uncovered changed lines are detected. Injects `COVERAGE_REPORT` (the report text from `reportUncoveredChangedLines`). The advisory is **deliver-only**: the agent's response is logged but does not change the completion outcome, iteration count, or run status. Used by the write loop's completion path; see [`write-behavior.md`](./write-behavior.md#coverage-advisory).

## Plan and intent prompts

Plan draft and plan review inject `SPEC_GUIDANCE` from [`spec-guidance-agent-core.md`](./spec-guidance-agent-core.md) at the install root (agent core only; operator CLI guidance stays in [`v1/docs/spec-guidance.md`](../../v1/docs/spec-guidance.md)). Intent review injects the same agent core as `SPEC_GUIDANCE`; intent split has no `SPEC_GUIDANCE` placeholder and instead directs the agent to read [`spec-guidance-agent-core.md`](./spec-guidance-agent-core.md) for sizing and reviewability. See [`write-behavior.md`](./write-behavior.md#plan-write-step-seeding-and-completion-contract), [`workflow-runner.md`](./workflow-runner.md#execution-contract).

- `plan.prompt.draft` — `WORKDIR`, `NAME`, `INTENT` (ready-intent seed); Rules carry step mechanics only (write boundaries, blocker contract, frontmatter preservation, subspec/index linkage), with authoring norms owned by injected `SPEC_GUIDANCE`
- `plan.prompt.review.*` — debate and light review roles with materialized draft context
- `plan.prompt.review-actuator` — verdict-application step mechanics including structural product-AC rewrite, plus injected `SPEC_GUIDANCE`
- `intent.prompt.split` — seed and staging placeholders; reads agent-core sizing guidance via prompt task (no `SPEC_GUIDANCE` injection)
- `intent.prompt.review` / `intent.prompt.review-actuator` — staged ready-intent Markdown and critic verdict slot
