---
name: mutation-verifier-ignores-whitespace-only-line-changes
---

# A reformatted (whitespace-only) changed line should not become a new mutation candidate

## Problem

The diff-derived verifier derives mutation candidates from every added/changed production line. When a formatter (biome) reflows or re-wraps a line because *adjacent* code changed, a **pre-existing, behavior-unchanged guard** lands in the diff and becomes a fresh candidate — the gate then demands new killing-test coverage for logic the change never touched. This is pure friction: nothing about the guard's behavior changed, so there is nothing new to test, yet it strands the run and forces a hand-authored (or mutation-repair) test for an untouched guard.

## Evidence (2026-08-30)

`accept-nested-plan-draft-stage-layout` (#3212): adding a clause to the `preserveStage` expression made biome wrap `reprompt !== undefined ||` onto its own line. The `reprompt !== undefined` guard is pre-existing and unchanged, but the reflow put it in the diff, so the verifier flagged `operator-flip: !== → ===` as a surviving mutation and stranded the implement at publication. Recovery cost a hand-authored killing test for a guard the spec never modified. This class recurs whenever a formatter reflows a line next to a real change.

## Decisions

- Before deriving candidates from a changed line, compare it against its base-ref counterpart with **whitespace normalized** (collapse runs of whitespace, ignore leading/trailing and line-wrap differences within the logical statement). If a changed line's normalized token stream is identical to a base line's, derive no new candidates from it — the guard is pre-existing and unchanged. Rules out treating a reflow as new logic.
- Genuine token changes (a new/edited operator, identifier, or literal) still derive candidates — normalization is whitespace-only, never semantic. Rules out masking a real guard change.
- Scope: candidate derivation in `v2/src/execution/diff-derived-mutation-verifier.ts` (operator-flip and guard-flip families); no change to killing-test resolution, render coverage, or the surviving-mutation contract.
- Keep it diff-local: the comparison is against the base-ref version of the same logical line, not a whole-file reformat detector.

## Acceptance criteria

- [ ] A `diff-derived-mutation-verifier.test.ts` regression drives a diff where a pre-existing guard line is only reflowed (e.g. `x !== undefined || (a && b)` wrapped across lines with a new clause added elsewhere) and proves the unchanged guard yields no operator-flip/guard-flip candidate, while the genuinely-new clause still does; it fails against the pre-fix derivation that flags the reflowed guard.
- [ ] A regression proves a real token change on a reflowed line (e.g. `!==` edited to `===`, or a renamed identifier) still derives its candidate — whitespace normalization does not mask a semantic change.
- [ ] A regression proves indentation-only and trailing-whitespace changes derive no new candidates.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/operator-runbook.md` — Gate trust / mutation verification: a reformatted (whitespace-only) changed line is not a new candidate; only semantic token changes are.
- `v2/docs/workflow-runner.md` — candidate derivation ignores whitespace-only line changes.
