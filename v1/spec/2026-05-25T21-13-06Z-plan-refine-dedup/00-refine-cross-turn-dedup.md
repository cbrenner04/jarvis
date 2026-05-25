# 00 - refine cross-turn dedup directive

## Problem

The refine phase is structurally append-only (`prompts/plan/refine.md:45`,
enforced by `isValidRefineTurnAddition` in `v1/src/modes/plan/refine.ts`): each
turn appends a fresh `## Refine turn N` and may not edit prior text. The
decisions-ledger fragment governs the *shape within* a turn (atomic one-liners,
no narrative), but nothing governs *across* turns. Re-reading the whole intent
each turn and being rewarded for "adding precision," the agent re-derives
decisions earlier turns already settled. PR #147's intent ran 171 lines with the
build-order/architecture binding restated across turns 2 and 3 and the
docs-home guidance restated across turns 1, 2, and 3.

This spec adds the cross-turn brake the ledger fragment is missing, staying
inside the existing append-only contract — prompt-only, no code change.

## Decisions

- Edit the `plan.prompt.refine` step prompt body (`prompts/plan/refine.md`)
  only. No fragment: cross-turn dedup is refine-specific (draft creates, review
  compresses spec files), so a shared fragment would be misplaced.
- The directive: a `## Refine turn N` section records only decisions,
  constraints, assumptions, or risks **not already recorded in an earlier turn**.
  Do not restate, rephrase, or lightly re-scope a prior turn's entry.
- If a turn would only restate prior turns, take the existing `## Refine skip`
  outcome instead of appending a near-duplicate turn. (Reinforces the
  already-present "use a skip only when you are done" line for the dedup case.)
- A later turn that genuinely *sharpens* an earlier decision still cannot edit it
  (append-only stands); record the sharpened form as a new entry and name what it
  supersedes in its trailing clause. This residue is the cost append-only imposes
  and the reason the single-living-ledger spec follows.
- Keep it directional, not numeric: no cap on turns or entries. Consistent with
  the ledger fragment (thoroughness is the goal; terseness governs prose, never
  decision count) and the project's no-inflation-target rule.
- Editing `refine.md` changes only the rendered refine prompt. Bump
  `plan.prompt.refine` revision (relative to `main` at implementation time;
  currently `4`) and regenerate its rendered fixture. `plan.prompt.draft` and
  `plan.prompt.review` are untouched.

## Non-goals

- No code change to `v1/src/modes/plan/refine.ts`; append-only validation stays
  exactly as-is.
- No removal or relaxation of the append-only directive (that is the
  single-living-ledger spec).
- No numeric cap on turns or entries; no change to `--refine-turns` defaults.
- No new fragment; no change to draft/review prompts; no patch-mode change.
- No change to the `## Refine turn N` / `## Refine skip` / `## Blocker` heading
  contracts.

## Tasks

- [ ] Edit `prompts/plan/refine.md` to add the cross-turn dedup directive per the
  decisions above (the `## Persisted outcomes` "Refinement" item and/or
  `## Instructions` footer are the natural homes; align with the existing
  `## Multi-turn budget` skip guidance).
- [ ] Bump `plan.prompt.refine` revision; regenerate the rendered-prompt fixture
  under `v1/test/fixtures/prompts/rendered/` for refine.
- [ ] Update the `plan.prompt.refine` revision assertion in
  `v1/test/prompts/rendered-snapshots.test.ts`.
- [ ] Run `bun run typecheck` and `bun test`.

## Acceptance criteria

- [ ] `prompts/plan/refine.md` instructs that a refine turn records only
  decisions not already recorded in an earlier turn, and to take `## Refine skip`
  rather than append a restating turn.
- [ ] The refine prompt contains no numeric cap on turns or entries.
- [ ] `v1/src/modes/plan/refine.ts` is unchanged (append-only validation intact).
- [ ] `plan.prompt.draft` and `plan.prompt.review` bodies and revisions are
  unchanged.
- [ ] Rendered-prompt snapshot tests pass against the regenerated, revision-keyed
  refine fixture.
- [ ] `bun run typecheck` and `bun test` pass.

## Documentation updates

- If `v1/docs/plan-mode.md` or `v1/docs/prompt-governance.md` characterizes refine
  turn content, add a one-line note that turns must not restate prior turns. No
  new standalone doc.
