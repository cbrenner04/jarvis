# Hunk-paired whitespace skip for operator-flip and guard-flip derivation

`deriveCandidates` (`v2/src/execution/diff-derived-mutation-verifier.ts`) feeds every changed production line through `deriveOperatorMutations` / `deriveGuardMutations` keyed only on physical line numbers. When Biome wraps a pre-existing expression because a neighbor line changed, that expression lands on a new `+` line and yields flip candidates even though tokens are unchanged (#3212: `reprompt !== undefined ||` wrapped alone).

## Decisions

- Whitespace normalization for skip compares collapses internal whitespace runs and ignores leading/trailing whitespace on each line; rules out byte-identical or trim-only equality, which would not match reflow-within-a-logical-statement.
- Skip applies only to operator-flip and guard-flip families inside `deriveOperatorMutations` / `deriveGuardMutations` (or a shared helper they call); rules out changing destructive-operation or subprocess candidate derivation, killing-test resolution, render coverage, or surviving-mutation settlement.
- Pairing is hunk-scoped against removed (`-`) lines, not per-line `-`/`+` index alignment; rules out base-ref line pairing, which fails when one removed line splits into several added lines.
- Within each diff hunk, skip an operator-flip or guard-flip candidate on a changed `+` line only when the hunk has removed lines and both the whole line's whitespace-normalized token sequence and that candidate's operand token sequence appear in order and contiguously in the hunk's joined removed-line token stream (lines consume matched removed spans in diff order, so a duplicated copy still derives; an unordered multiset compare is ruled out because it skips operand/operator swaps like `a > b` → `b > a`); any new semantic token on the line or in the candidate keeps derivation (including extra flip candidates when reflow and new tokens share one `+` line); rules out whole-file or AST remapping for reformat detection.
- Hunks with no removed lines (pure insertions) never skip flip derivation from whitespace comparison; rules out treating insertions as whitespace-only reformats.
- Guard-flip admission stays single-line physical span only; whitespace skip for guard-flip applies only on lines already admitted under that rule; rules out expanding guard-flip to multi-line reflows.

## Tasks

- [x] Add whitespace-normalized token extraction for flip skip (collapse runs; strip line edges) and build per-hunk joined removed-line token stream from the same changed-line input `deriveCandidates` already receives (extend diff parsing or hunk metadata if needed).
- [x] Before recording an operator-flip or guard-flip candidate on a changed line, apply hunk removed-line ordered contiguous match; leave destructive and subprocess derivation untouched.
- [x] Extend `diff-derived-mutation-verifier.test.ts` with reflow, semantic-change, and whitespace-only regressions named in acceptance criteria.
- [x] Update operator-facing docs per Documentation updates (canonical prose in `write-behavior.md`; cross-links elsewhere).

## Acceptance criteria

- [x] `diff-derived-mutation-verifier.test.ts` drives a diff where a pre-existing operator expression is reflowed onto one changed `+` line (e.g. `x !== undefined || (a && b)` alone on that line) while a genuinely new clause lands on another changed line, asserts the reflowed line yields no operator-flip candidate and the new clause still does, and fails against pre-fix derivation that flags the reflowed line; guard-flip is asserted only when `!` stays on a single changed physical line under the existing admission rule.
- [x] `diff-derived-mutation-verifier.test.ts` regression proves a real token change on a reflowed line (e.g. `!==` → `===` or a renamed identifier) still derives its flip candidate; fails against pre-fix code that would skip all candidates on whitespace-normalized match.
- [x] `diff-derived-mutation-verifier.test.ts` regression proves indentation-only and trailing-whitespace edits derive no new operator-flip or guard-flip candidates; fails against pre-fix derivation.
- [x] `diff-derived-mutation-verifier.test.ts` operator-classification, guard-admission boundary, destructive/subprocess, killing-test resolution, and surviving-mutation settlement tests stay green (reachable on `main`: those describe blocks pin adjacent verifier behavior unchanged by this derivation-only change).
- [x] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/write-behavior.md` § Diff-derived mutation verification — changed-line classification: whitespace-only reformatted `+` lines are not new operator-flip or guard-flip candidates; semantic token changes still are; hunk removed-line whitespace-normalized ordered contiguous match as in Decisions.
- `v2/docs/v1-behaviors.md` — `[v2 behavior change]` parity entry for the same delta (sources: `diff-derived-mutation-verifier.ts`, `write-behavior.md`).
- `v2/docs/operator-runbook.md` — Gate trust / mutation verification: cross-link `write-behavior.md#diff-derived-mutation-verification` for candidate derivation (no duplicate derivation prose).
- `v2/docs/workflow-runner.md` — cross-link `write-behavior.md#diff-derived-mutation-verification` where implement completion describes diff-derived candidate derivation.
