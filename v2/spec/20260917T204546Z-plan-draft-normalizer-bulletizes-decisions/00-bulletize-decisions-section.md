# Bulletize bare `## Decisions` lines in the plan-draft normalizer

## Problem

`normalizePlanDraftSpecDir` (`shared/module-boundary-surfaces.ts`, invoked from `v2/src/execution/write.ts`) only validates a staged draft; it never rewrites it. A drafter that emits bare consecutive lines under `## Decisions` instead of a bullet list reaches staged Markdown lint unchanged and is rejected by the `no-hard-wrap` rule, spending the run's single in-loop draft repair on a mechanically fixable defect.

## Decisions

- A line under `## Decisions` is bulletized when it is non-blank, has no leading list marker, sits outside a fenced block, and its immediately preceding non-blank line in the original file is not an existing bullet line; that last case is already joined as a continuation of the preceding bullet by `sectionBulletTexts` today, and is left untouched. Rules out splitting a run of bare lines that follows an authored bullet into new bullets, which would change existing multi-line-bullet continuation semantics.
- `normalizePlanDraftSpecDir` gains a parameter distinguishing a staging call (rewrite allowed) from a durable/validate-only call (no rewrite); only the staging call in `validatePlanDraft` that targets the staging directory passes rewrite-allowed, while the durable-dir fallback inside `composePlanDraftArtifactCheck` passes validate-only. Rules out silently bulletizing already-committed spec bytes when the staging check fails and the durable fallback runs.
- One bare line always becomes exactly one bullet; the pass does not attempt to tell a hard-wrapped continuation of the prior bare line's prose apart from a genuinely new entry, so a hard-wrapped decision mis-splits into multiple bullets. Rules out reflow-aware merging: the prompt-guidance prerequisite already asks drafters for one entry per line, so merging heuristics would add complexity to cover a case the guidance is meant to prevent.
- `lintReviewedStagedMarkdownOrFail` (the review-debate landing re-lint) is out of scope and keeps re-linting without calling the normalizer; a bare-line draft that reaches that path without first passing through `validatePlanDraft` still fails lint there. Rules out extending bulletization to a second call site the intent didn't ask for.
- Bulletization runs before the existing one-artifact-per-bullet check, so repaired lines are validated like authored bullets; rules out a repair path that smuggles multi-artifact lines past the contract.
- When a `## Decisions` section has nothing to bulletize, the file is not written at all (not merely returned byte-identical); rules out an unconditional read-modify-write that would touch mtimes on every recovery re-run over foreign bytes.

## Task checklist

- [ ] Add the `## Decisions` bulletization pass to `normalizePlanDraftSpecDir`, gated on a staging/rewrite-allowed vs durable/validate-only mode, writing a changed subspec back to disk only in the rewrite-allowed mode and only when a rewrite actually occurs.
- [ ] Thread the mode through `validatePlanDraft`'s two call sites so the staging call passes rewrite-allowed and the `composePlanDraftArtifactCheck` durable-dir fallback passes validate-only.
- [ ] Cover the bare-line, continuation-after-bullet, already-bulleted, other-section (including fenced block), durable-no-write, and no-op-no-write cases in the normalizer test file.
- [ ] Record the behavior in `v2/docs/v1-behaviors.md` and `v2/docs/write-behavior.md`.

## Acceptance criteria

- [ ] A test in `shared/module-boundary-surfaces.test.ts` asserts bare consecutive lines under `## Decisions`, run through the staging (rewrite-allowed) mode, are rewritten on disk as one `-` bullet per line and the rewritten bytes satisfy the staged-lint `no-hard-wrap` rule; it fails against the pre-change normalizer.
- [ ] A test asserts a bare line that immediately follows an existing bullet line (no blank line between) is left unchanged as a continuation of that bullet, not split into a new bullet.
- [ ] A test asserts an already-bulleted `## Decisions` section, a blank-line-separated one, and content under other headings (including a fenced block) come back byte-identical, and that no file is rewritten on disk in that case (e.g. via unchanged mtime or a write-call spy).
- [ ] A test asserts a bare line naming multiple artifact paths under `## Decisions`, run through the durable (validate-only) mode, produces no artifact-count offender because it is not parsed as a bullet, while the same content run through the staging (rewrite-allowed) mode is bulletized and then produces the one-artifact-per-bullet offender message — pinning the offender set on both sides of the rewrite.
- [ ] A test asserts the durable (validate-only) mode never writes to disk even when the tree contains bare `## Decisions` lines that the staging mode would bulletize.
- [ ] `v2/docs/v1-behaviors.md` records that plan-draft normalization bulletizes bare `## Decisions` lines before validation and lint, scoped to the staging call only.
- [ ] `v2/docs/write-behavior.md`'s draft-output-shape-contract section is updated to no longer say the normalizer never rewrites bodies, and states the rewrite is staging-only.
- [ ] `bun run typecheck`, `bun run test:v2`, `bun run test:integration:v2`, and `bun run test:shared` pass.

## Documentation updates

- `v2/docs/v1-behaviors.md` — extend the plan-draft normalization entry with the `## Decisions` bulletization pass, its bare-line predicate (including the continuation-after-bullet exception), its section scoping, its staging-only write, and its leave-unchanged/no-write cases.
- `v2/docs/write-behavior.md` — update the draft-output-shape-contract paragraph, which currently states the normalizer never rewrites bodies, to describe the staging-only `## Decisions` bulletization rewrite.
