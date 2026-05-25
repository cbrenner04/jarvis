# 00 - plan.decisions-ledger prompt fragment

## Problem

Plan-mode intents and specs grow long and the decisions get lost. `global.terse`
("be terse... minimize it") is a soft style prior with no target and no shape; it
loses to the stronger pull of "be a thorough planner," and the loop's own
incentives fight it — refine appends, draft expands, review rewrites, and no phase
is told to compress. The author's real complaint is salience, not volume: a spec
where the load-bearing calls are buried in narrative is unreviewable even when
short, and the operator can't see what was decided or why.

The fix is structural, not a length plea. A spec that makes 40 atomic decisions is
exactly what's wanted — thorough, nothing left to the implementer. A spec with 6
decisions buried in 300 lines of prose is the disease. So terseness must govern
prose-per-entry, never the number of entries.

## Decisions

- Add one shared fragment `prompts/plan/decisions-ledger.md`, id
  `plan.decisions-ledger` (frontmatter: behavior `agent-facing`, kind `fragment`,
  revision `1`), mirroring the `global.terse` shape.
- Body states the rule tersely:
  - Record decisions, constraints, and assumptions as a ledger of atomic entries,
    one per line — not narrative paragraphs.
  - Per entry: state the decision; add a one-line trailing rationale clause only
    where the "why" is non-obvious.
  - Do not cap the number of entries. Make every call an implementer would
    otherwise have to make; thoroughness is the goal. Terseness governs the prose
    in each entry, never the entry count.
  - No narrative justification paragraphs around the ledger; the ledger is the
    record of what was decided and why.
  - Keep each subspec one independently reviewable change; when it would not be,
    split it rather than absorb scope.
- Wire `plan.decisions-ledger` into `globalFragmentIds` in
  `v1/src/modes/plan/refine.ts`, `draft.ts`, and `review.ts` (alongside the
  existing `global.documentation`, `global.terse`). Refine governs intent
  authoring; draft and review govern the spec tree — the user named both intent
  and spec creation, so the shape must apply across all three.
- Register the new path in `v1/src/prompts/registry.ts` `PROMPT_ARTIFACT_FILES`.
- Adding a fragment changes all three rendered plan prompts, which are
  snapshot-governed. Bump `plan.prompt.refine`, `plan.prompt.draft`, and
  `plan.prompt.review` revisions and regenerate their rendered fixtures per the
  prompt-governance standard. Bump relative to whatever revision is on `main` at
  implementation time (other in-flight plan-prompt specs may have bumped first);
  do not hardcode a target revision number.
- No change to refine validation, permitted section types, or budgets. Ledger
  entries are recorded within the existing `## Refine turn N` / draft / review
  output; the loop's section grammar is untouched.

## Non-goals

- **Subtractive review** (review as a compressor with non-increasing length) is a
  separate spec that builds on this shape. Out of scope here.
- **No prose-length numbers or caps.** A cap becomes an inflation target (the
  agent shoots for the limit); this spec adds shape, not a budget.
- No patch-mode wiring: patch implements against an existing spec where the
  decisions are already made.
- No telemetry / size-counter work.
- No change to `--refine-turns` / `--review-passes` defaults or the
  interactive/non-interactive boundary.

## Tasks

- [ ] Create `prompts/plan/decisions-ledger.md` with fragment frontmatter and the
  ledger-rule body above.
- [ ] Register the new path in `v1/src/prompts/registry.ts`
  `PROMPT_ARTIFACT_FILES`.
- [ ] Add `plan.decisions-ledger` to `globalFragmentIds` in
  `v1/src/modes/plan/refine.ts`, `draft.ts`, and `review.ts`.
- [ ] Bump revisions for `plan.prompt.refine`, `plan.prompt.draft`,
  `plan.prompt.review`; regenerate the rendered-prompt fixtures under
  `v1/test/fixtures/prompts/rendered/` (including per-pass review variants).
- [ ] Update revision assertions in
  `v1/test/prompts/rendered-snapshots.test.ts`.
- [ ] Run `bun run typecheck` and `bun test`.

## Acceptance criteria

- [ ] `prompts/plan/decisions-ledger.md` exists with id `plan.decisions-ledger`
  and loads via the prompt registry.
- [ ] Rendered refine, draft, and review prompts include the ledger-rule text.
- [ ] The fragment instructs that entry count is uncapped and contains no numeric
  length limit.
- [ ] The patch prompt does not include the fragment.
- [ ] Rendered-prompt snapshot tests pass against regenerated, revision-keyed
  fixtures for all three plan phases.
- [ ] `bun run typecheck` and `bun test` pass.

## Documentation updates

- Add `plan.decisions-ledger` to the global/plan fragment set wherever it is
  enumerated per phase (`v1/docs/prompt-governance.md`, and `v1/docs/plan-mode.md`
  if it lists fragments). No new standalone doc.
