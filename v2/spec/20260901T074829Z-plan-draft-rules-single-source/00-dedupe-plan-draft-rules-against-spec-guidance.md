# Dedupe plan draft and review-actuator Rules against injected SPEC_GUIDANCE

## Prerequisites

- Plan draft and plan review assembly inject `v2/docs/spec-guidance-agent-core.md` as `SPEC_GUIDANCE` from the shared resolver.
- Guard-inversion checkpoint authoring is retired from plan prompts and default write-step rules.

## Problem

- `prompts/plan/draft.md` Rules restate failing-test, agent-verifiable-AC, self-referential-deliverable, and product-vs-harness behavioral-AC guidance already injected via `SPEC_GUIDANCE`, worded differently from `v2/docs/spec-guidance-agent-core.md`.
- Two divergent normative copies force agents to reconcile wording and require duplicate edits for every rule change.

## Behavior

- Plan-draft Rules keep only step mechanics: write boundaries, no commit/push, no tests, blocker contract, frontmatter preservation, and subspec/index linkage.
- Review-actuator Rules keep step mechanics plus verdict-application mechanics, including the structural product-AC rewrite obligation when applying a verdict.
- Each draft-time authoring norm appears once in the assembled plan-draft prompt, sourced from injected `SPEC_GUIDANCE`; removed draft Rules bullets do not survive in template bodies or appended step-rules sections.
- Where a removed draft Rules bullet and the agent-core copy disagreed in wording, the agent-core wording is authoritative.
- Plan-draft normalizer and validator behavior stay unchanged.

## Decision ledger

- Own draft-time authoring rules only in injected agent-core guidance; rules out retaining parallel normative copies in plan-draft Rules sections.
- Sequence after the agent-core injection split and guard-inversion retirement; rules out deduping into guidance files that were about to be split or deleting prose that checkpoint retirement already removed.
- Retain review-actuator `Rewrite structural **product**…` bullet as verdict-application step mechanics; rules out treating it as draft-time authoring duplicate and removing it.
- Pin dedup with render tests that count contract phrases on the fully assembled plan-draft prompt (template plus injected `SPEC_GUIDANCE` from `readSpecGuidance()`); rules out body-only substring checks that miss duplicate injection zones.
- Pin review-actuator rewrite survival with `Rewrite structural **product**` exactly once on the fully assembled review-actuator prompt; rules out `when structure is the contract` as dedup proof (shared substring with agent-core harness bullet).
- Preserve normalizer and validator behavior by citing existing plan workflow tests; rules out paraphrasing unchanged behavior in new AC prose.
- Drop guard-inversion single-occurrence pins; rules out reintroducing retired checkpoint-authoring contract phrases solely to satisfy a stale seed bullet.
- Self-referential: draft Rules used "Do not propose self-referential deliverables…"; agent-core uses "Plan-mode prompts forbid self-referential deliverables…" — agent-core authoritative.
- Product-vs-harness AC: draft Rules used "observable behavior, not implementation structure" Good/Bad examples; agent-core uses `### Behavioral acceptance criteria` product/harness bullets — agent-core authoritative; assembled plan-draft must not contain the draft paraphrase substring `observable behavior, not implementation structure`.
- Failing-test: draft Rules carried a single summary bullet; agent-core carries the full `#### Failing-test requirement` section — shared anchor phrase `fails against the pre-fix code and passes after the change` is authoritative; remove the duplicate Rules bullet only.
- Agent-verifiable: draft Rules used "verifiable from the implement worktree without network or GitHub access"; agent-core uses "verifiable from the implement agent's worktree environment **without network or GitHub access**" — agent-core authoritative; pin authoritative anchor `without network or GitHub access` exactly once on assembled plan-draft.

## Tasks

- Remove duplicate authoring-rule bullets from `prompts/plan/draft.md` Rules (self-referential deliverables, product-vs-harness behavioral AC, failing-test requirement, agent-verifiable AC); keep step-mechanics bullets; bump `revision` when bytes change.
- Keep the structural product-AC rewrite bullet in `prompts/plan/review-actuator.md` Rules as verdict-application step mechanics; no other review-actuator Rules changes unless bytes shift incidentally.
- Extend `shared/prompts/plan-draft.test.ts` with a test that builds the fully assembled plan-draft prompt via `buildPlanDraftPrompt` with `specGuidance: readSpecGuidance()` and counts single occurrences of the contract phrases; assert absence of `observable behavior, not implementation structure`.
- Update `shared/prompts/plan-draft.test.ts` `omits runtime suffix sections when specDir and stepRules are absent` to use `readSpecGuidance()` (or drop the failing-test assertion from the minimal-assembly case) so it stays green after Rules removal.
- Add or extend `shared/prompts/review-plan-hollow-pin.test.ts` (via `renderPlanReviewActuatorPrompt` with a minimal fixture) asserting `Rewrite structural **product**` appears exactly once on the fully assembled review-actuator prompt.
- Update `v1/test/modes/plan/prompts.test.ts` and refresh `v1/test/fixtures/prompts/rendered/**` snapshots so v1 draft/review-actuator pins expect authoring norms from injected `SPEC_GUIDANCE` only, not duplicate draft Rules bullets; review-actuator rewrite bullet expectations unchanged.
- Update `v2/docs/prompts.md` and `v2/docs/v1-behaviors.md` per Documentation updates below.

## Acceptance criteria

- [ ] `shared/prompts/plan-draft.test.ts` asserts the fully assembled plan-draft prompt contains `fails against the pre-fix code and passes after the change` exactly once; it fails against the pre-fix duplicate Rules copy.
- [ ] The same test asserts `without network or GitHub access` appears exactly once on the assembled plan-draft prompt; it fails against the pre-fix duplicate Rules copy.
- [ ] The same test asserts `self-referential deliverables` appears exactly once on the assembled plan-draft prompt; it fails against the pre-fix duplicate Rules copy.
- [ ] The same test asserts the assembled plan-draft prompt does not contain `observable behavior, not implementation structure`; it fails against the pre-fix duplicate Rules paraphrase.
- [ ] `shared/prompts/plan-draft.test.ts` test `renders named pre-fix failing-test guidance without checkpoint authoring` stays green.
- [ ] `shared/prompts/plan-draft.test.ts` test `omits runtime suffix sections when specDir and stepRules are absent` stays green after Rules removal.
- [ ] `shared/prompts/review-plan-hollow-pin.test.ts` asserts the fully assembled review-actuator prompt contains `Rewrite structural **product**` exactly once.
- [ ] `v1/test/modes/plan/prompts.test.ts` draft/review-actuator coverage asserts authoring norms appear from injected `SPEC_GUIDANCE` (real guidance), not duplicate draft Rules bullets; rendered snapshot fixtures under `v1/test/fixtures/prompts/rendered/**` match bumped revisions.
- [ ] `v2/src/execution/write.test.ts` plan-draft normalization and shape-contract tests stay green (behavior unchanged by the dedup).
- [ ] `v2/src/execution/write-loop.test.ts` plan-draft normalizer `contract_miss` tests stay green (behavior unchanged by the dedup).
- [ ] `bun run typecheck` passes.
- [ ] `bun run test:shared` passes.
- [ ] `bun run test:v1` passes.
- [ ] `bun run test:v2` passes.
- [ ] `bun run test:integration:v2` passes.
- [ ] `v2/docs/prompts.md` notes that plan draft Rules carry step mechanics only, with authoring rules owned by injected `SPEC_GUIDANCE`; review-actuator Rules add verdict-application mechanics.
- [ ] `v2/docs/v1-behaviors.md` catalog entries for self-referential, behavioral-AC, and failing-test enforcement attribute source to injected `SPEC_GUIDANCE` (not duplicate `prompts/plan/draft.md` Rules bullets).

## Documentation updates

- `v2/docs/prompts.md` — note that plan draft Rules carry step mechanics only, with authoring rules owned by injected `SPEC_GUIDANCE`; review-actuator Rules add verdict-application mechanics including structural product-AC rewrite.
- `v2/docs/v1-behaviors.md` — revise plan-mode catalog entries (~lines 205–207) so enforcement attribution names injected `SPEC_GUIDANCE` / agent-core, not duplicate draft Rules bullets.
