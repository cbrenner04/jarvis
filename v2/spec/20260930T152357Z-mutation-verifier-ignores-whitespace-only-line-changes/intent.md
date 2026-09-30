---
name: mutation-verifier-ignores-whitespace-only-line-changes
---

# A reformatted (whitespace-only) changed line is not a new mutation candidate

Unsplit rationale: candidate derivation for operator-flip and guard-flip families lives only in `diff-derived-mutation-verifier.ts`; killing-test resolution, render coverage, and surviving-mutation settlement are unchanged; canonical contract update in `write-behavior.md` with runbook/workflow cross-links only.

## Primary implementation surface

`v2/src/execution/diff-derived-mutation-verifier.ts` (diff-local candidate derivation from changed production lines)

## Problem

The diff-derived verifier derives mutation candidates from every added/changed production line. When a formatter reflows a pre-existing operator expression (including guards expressed as comparisons/`||`/`&&`) because adjacent code changed, the unchanged expression lands in the diff and becomes a fresh candidate — the gate then demands new killing-test coverage for logic the change never touched. Guard-flip (`!` prefix) already admits only single-line spans; multi-line reflow pain is primarily operator-flip and other per-line patterns on each changed physical line.

## Decisions

- Before deriving candidates from a changed line, compare it against its base-ref counterpart with whitespace normalized (collapse runs of whitespace; ignore leading/trailing and line-wrap differences within the logical statement). When normalized token streams match, derive no operator-flip or guard-flip candidates from that line.
- Whitespace-only normalization: genuine token changes (operator, identifier, literal) still derive candidates.
- Base-ref counterpart is hunk-level, not line-paired: a reflow splits one `-` line into several `+` lines, so per-line pairing never matches the motivating case (#3212 wrapped `reprompt !== undefined ||` onto its own line). Within each hunk, a candidate is skipped when its operator occurrence plus its operand tokens on that line appear, whitespace-normalized, in the hunk's removed (`-`) token stream the same number of times or more. Pure insertions (no `-` lines in the hunk) always derive. No whole-file reformat detection or AST remapping.
- Guard-flip scope unchanged: only when `!` sits on a changed line and the negation span fits on that one physical line; multi-line reflow does not expand guard-flip — whitespace skip for guard-flip applies only on those already-admitted single-line guard lines.
- Scope: operator-flip and guard-flip candidate derivation only; no change to killing-test resolution, render coverage, or the surviving-mutation contract.

## Acceptance criteria

- [ ] `diff-derived-mutation-verifier.test.ts` drives a diff where a pre-existing operator/guard expression line is only reflowed (e.g. `x !== undefined || (a && b)` wrapped on one changed `+` line with a new clause added on another changed line) and proves the reflowed line yields no operator-flip candidate while the genuinely new clause still does; it fails against the pre-fix derivation that flags the reflowed line. Guard-flip is asserted only when the scenario keeps `!` on a single changed physical line (existing admission rule).
- [ ] A regression in `diff-derived-mutation-verifier.test.ts` proves a real token change on a reflowed line (e.g. `!==` edited to `===`, or a renamed identifier) still derives its candidate; whitespace normalization does not mask a semantic change.
- [ ] A regression in `diff-derived-mutation-verifier.test.ts` proves indentation-only and trailing-whitespace changes derive no new candidates.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` — Diff-derived mutation verification / changed-line classification: whitespace-only reformatted `+` lines are not new operator-flip or guard-flip candidates; semantic token changes still are; hunk-paired `-` comparison as above.
- `v2/docs/v1-behaviors.md` — same behavior delta for the parity catalog.
- `v2/docs/operator-runbook.md` — Gate trust / mutation verification: cross-link `write-behavior.md` (no duplicate derivation prose).
- `v2/docs/workflow-runner.md` — cross-link `write-behavior.md` for candidate derivation.

## Prerequisites
