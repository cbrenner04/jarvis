# Verdict: Required refinements

## 1. Reframe the primary acceptance criterion for enforcement-only work

The first acceptance criterion must stop claiming that a missing test file or pre-fix divergence is the failing surface. Prerequisites are already satisfied; landing the alignment test will likely pass immediately after helper extraction. Per spec guidance, new-behavior ACs must describe verifiable runtime outcomes, and invert guards supply TDD evidence for enforcement pins.

**Required outcome:** AC1 states that `pipeline-posture-cli-alignment.test.ts` passes when pipeline realizability and CLI parse acceptance agree for all nine cells, and fails when they diverge. Drop “absent pre-fix” / “fails until file lands” wording. Tie AC1 explicitly to AC3 (invert on `implement` + `none`) as the guard that proves the alignment loop is load-bearing.

## 2. Move behavior-preservation into `## Acceptance criteria`

The task checklist cites `pipeline-definition-validation.test.ts` (`"implement under none is unrealizable; light on the same stage validates clean"`) as a preservation requirement, but preservation belongs in acceptance criteria per spec guidance (cite the test, don’t paraphrase).

**Required outcome:** Add an acceptance criterion that `pipeline-definition-validation.test.ts` `"implement under none is unrealizable; light on the same stage validates clean"` stays green. Remove duplication from the task checklist or demote it to an implementation pointer only.

## 3. Sync `intent.md` symbol naming with the subspec

`intent.md` still references `isUnrealizableReview`; the subspec commits to `isUnrealizableWorkflowReview` and routes validation through it.

**Required outcome:** Intent decisions use the same exported helper name and contract as the subspec so merge does not leave contradictory vocabulary.

## 4. Narrow problem prose to match admitted scope

The problem statement implies full “posture table vs workflow CLI” parity, but decisions deliberately limit the slice to pipeline **admission** (`isUnrealizableWorkflowReview`) vs bare-workflow **CLI parse** acceptance under the mapped review flags. Resolver presets, role bindings, and parsed field values are out of scope and covered elsewhere.

**Required outcome:** Problem statement (subspec and intent) says admission vs CLI-parse alignment for the nine-cell `(workflow, posture)` matrix, not end-to-end posture-table or operator parity.

## 5. Pin CLI argv mapping decisions

Implementers need unambiguous fixtures for the three parsers and for how `none` maps.

**Required outcome:** Decisions specify:
- `none` → explicit `--review-passes 0` (pipeline-canonical; not flag omission).
- Minimal per-workflow argv: intent satisfies the `--seed` / `--seed-text` xor (e.g. `--seed-text` with a literal); plan uses `--ready-intent` with a dummy path; implement uses `--base` + `--spec` with dummy paths.
- Realizable cells assert mapped argv parses `{ ok: true }`; unrealizable `implement` + `none` builds no CLI argv (structural exclusion, not comparison to `implement --review-passes 0`).

## 6. Sharpen coverage acceptance criterion

AC2 spot-checks `intent` + `debate` and `implement` + `none` but should state the exhaustive contract the `describe` block implements.

**Required outcome:** AC2 requires every `(intent|plan|implement) × (none|light|debate)` cell, with all eight realizable cells invoking the corresponding `parse*WorkflowArgs` under mapped review flags, and `implement` + `none` treated as unrealizable without CLI argv construction.

## 7. Correct imprecise validation routing language

The task checklist names `validateWorkflowStage`, which is private.

**Required outcome:** Task wording routes the existing `implement` + `none` check through the exported helper on the `validatePipelineDefinition` admission path, without naming private internals.

## 8. Acknowledge alignment-test boundary for the unrealizable matrix

The alignment loop skips CLI construction when the helper marks a cell unrealizable, so a spurious re-addition of `intent` + `debate` to the unrealizable set would not surface as CLI divergence. That is acceptable only if the spec states the contract: the alignment test enforces **cross-source consistency given the fixed unrealizable matrix**, not which cells belong in it.

**Required outcome:** Decisions or prerequisites note that `intent` + `debate` realizable and sole-unrealizable-pair (`implement` + `none`) are pinned upstream (e.g. existing validation tests); this slice adds the admission ↔ CLI-parse cross-check on top.

---

## Rationale summary

| Refinement | Why |
|------------|-----|
| AC1 reframe | Weak “missing file” AC violates failing-test guidance; enforcement-only slice needs honest regression framing plus invert guard as evidence. |
| Preservation in AC | Spec guidance requires refactor preservation as cited test in `## Acceptance criteria`, not task checklist only. |
| Intent symbol sync | Prevents merge with contradictory helper naming. |
| Scope narrowing | Problem prose must not overclaim relative to intent decisions and existing resolver/validation coverage. |
| Argv mapping | Removes implementer ambiguity on xor rules, dummy paths, and explicit zero passes. |
| AC2 sharpen | Exhaustive nine-cell loop is the contract; AC must say so, not only exemplars. |
| Validation wording | Avoids directing work at a private function. |
| Matrix boundary | Documents intentional blind spot so reviewers don’t expect the alignment test to re-litigate unrealizable membership. |

## Not required

- Splitting the subspec (helper extraction + alignment test is one seam).
- A dedicated helper-export AC (exercised by test import).
- A second invert AC for re-adding `intent` + `debate` to unrealizable (upstream validation test suffices).
- Mandating test file placement under `commands/` (execution colocation is intentional contract).
- End-to-end operator or preset-table parity (explicitly out of scope per intent).