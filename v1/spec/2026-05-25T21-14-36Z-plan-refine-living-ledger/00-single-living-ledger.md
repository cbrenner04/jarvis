# 00 - single living ledger

## Problem

Refine is append-only by contract: `prompts/plan/refine.md:45` forbids editing
prior text, and `isValidRefineTurnAddition` (`v1/src/modes/plan/refine.ts`)
enforces it by requiring everything before the new `## Refine turn N` heading to
match the prior content byte-for-byte. So a multi-turn intent can only grow, in
N stacked turn sections, and a later turn that revisits a decision must restate
rather than fix it. The result is turn-archaeology and cross-turn redundancy
(PR #147: 171 lines, settled decisions restated across turns).

Refine is the one plan phase still exempt from the "cut prose, never decisions"
principle the ledger fragment and subtractive review already carry. This spec
ends the exemption: remove append-only and make refine maintain a **single
living decisions ledger**, consolidated each turn. The intent reads as one
current artifact, not a changelog; history that matters lives in git across the
plan commits, not in the document.

## Decisions

### Document shape

- The intent is: frontmatter (frozen) → human-authored intent body (frozen) →
  one refine-owned ledger section → optional `## Blocker`. It reads top-to-bottom
  as one artifact with no turn-archaeology.
- The refine-owned ledger uses a single fixed heading `## Refinement` (level 2,
  exact), replacing the per-turn `## Refine turn N` headings. Pinned because the
  validator and tests key on it.
- **Frozen boundary:** everything above the first `## Refinement` heading is the
  human-authored seed and must be preserved exactly, except the already-permitted
  `name:` frontmatter write on the final pass. Refine may never rewrite the
  human's intent prose. Everything from `## Refinement` onward is refine-owned
  and rewritable.

### Refine behavior (prompt)

- Each turn rewrites/consolidates the `## Refinement` ledger in place: merge new
  analysis in, fold restated entries together, sharpen earlier entries directly
  rather than appending a superseding copy.
- Consolidation removes restatement and narrative, **never decisions**: preserve
  every prior decision/constraint/assumption/risk unless it is genuinely
  superseded, and when superseding, keep the sharpened form. Same rule as the
  ledger fragment and subtractive review.
- Keep directional, not numeric: no cap on entries or turns; no length target.
- `## Refine skip` stays the terminal no-op: take it when a turn has nothing to
  add or consolidate. `## Blocker` is unchanged.
- All refine turns share this behavior, including resumed refinement turns
  (`plan: refine r<n>`); they consolidate the same `## Refinement` ledger rather
  than appending new sections.

### Validation (code)

- Remove the append-only directive from `prompts/plan/refine.md` and rewrite the
  `## Persisted outcomes` and `## Multi-turn budget` sections to the
  single-ledger / consolidation model.
- Replace `isValidRefineTurnAddition` with a consolidation validator: the frozen
  prefix above the first `## Refinement` heading (frontmatter-stripped, modulo the
  permitted `name:` write) must equal the prior seed; the region from
  `## Refinement` onward is unconstrained except it must exist when the outcome is
  "refined". Drop the turn-number→heading coupling in `runRefineTurn`
  (`turnNumber` still drives the budget loop, not a heading).
- Update `isValidRefineSkipAddition`: a valid skip leaves the existing ledger
  region unchanged (or no ledger yet) and carries `## Refine skip`.
- `classifyRefineIntentOutcome`: blocker > skip > refined; "refined" keys on the
  presence of `## Refinement`.
- Rewrite the turn error messages in `runRefineTurn` that reference
  `## Refine turn N` / "append-only" to the new contract; keep the
  unchanged-without-skip and frontmatter-only-change error paths.
- Editing `refine.md` changes the rendered refine prompt. Bump
  `plan.prompt.refine` revision (relative to `main` at implementation time) and
  regenerate its rendered fixture. `plan.prompt.draft` / `plan.prompt.review`
  untouched.

### Relationship to the dedup spec

- This supersedes the cross-turn dedup directive
  (`spec/.../plan-refine-dedup`). If that landed first, replace its "do not
  restate a prior turn" wording with the consolidation model here; if it has not,
  this stands alone. Either way the end state is one ledger, not N turns.

## Non-goals

- No numeric cap on entries or turns; no length target.
- No change to `--refine-turns` defaults/budget mechanics, the draft/review
  phases, or patch mode.
- Refine still never rewrites the human-authored intent body or the `## Blocker`
  contract.
- No new fragment.

## Tasks

- [ ] Rewrite `prompts/plan/refine.md`: remove the append-only rule, adopt the
  single `## Refinement` ledger + consolidation model in `## Persisted outcomes`,
  `## Multi-turn budget`, and `## Instructions`; keep skip/blocker contracts.
- [ ] Rewrite refine validation in `v1/src/modes/plan/refine.ts`
  (`isValidRefineTurnAddition` → consolidation validator, `isValidRefineSkipAddition`,
  `classifyRefineIntentOutcome`, `runRefineTurn` turn-section logic and error
  messages), preserving the frozen human seed.
- [ ] Update refine validation tests in `v1/test/modes/plan/prompts.test.ts`
  (the `## Refine turn` append-only cases) to the single-ledger contract.
- [ ] Bump `plan.prompt.refine` revision; regenerate the rendered fixture under
  `v1/test/fixtures/prompts/rendered/`; update the revision assertion in
  `v1/test/prompts/rendered-snapshots.test.ts`.
- [ ] Update `v1/docs/plan-mode.md` (the append-only / `## Refine turn N`
  descriptions, incl. resume) and `v1/docs/prompt-governance.md` if it
  characterizes refine.
- [ ] Run `bun run typecheck` and `bun test`.

## Acceptance criteria

- [ ] `prompts/plan/refine.md` contains no append-only directive and instructs
  refine to consolidate a single `## Refinement` ledger, preserving every prior
  decision unless genuinely superseded.
- [ ] The refine prompt states consolidation cuts restatement/narrative, never
  decisions, and contains no numeric cap or length target.
- [ ] `v1/src/modes/plan/refine.ts` accepts a turn that rewrites the
  `## Refinement` region while preserving the human-authored seed above it, and
  rejects any change to that seed (beyond the permitted `name:` frontmatter).
- [ ] A skip turn (ledger region unchanged + `## Refine skip`) and a blocker turn
  are both still accepted and classified correctly.
- [ ] `plan.prompt.draft` and `plan.prompt.review` bodies and revisions are
  unchanged.
- [ ] Rendered-prompt snapshot tests pass against the regenerated, revision-keyed
  refine fixture.
- [ ] `v1/docs/plan-mode.md` no longer describes refine as append-only / per-turn
  `## Refine turn N` sections.
- [ ] `bun run typecheck` and `bun test` pass.

## Documentation updates

- `v1/docs/plan-mode.md`: replace the append-only / `## Refine turn N`
  descriptions (Phase 0 and resume) with the single living-ledger model.
- `v1/docs/prompt-governance.md`: update the `plan.prompt.refine` characterization
  and revision note if present. No new standalone doc.
