# Plan draft rejects unsatisfiable acceptance criteria

A non-human-only acceptance criterion that asserts PR body/title, CI status, review
state, or another GitHub/network-only fact is not tickable from inside the implement
agent's worktree. Today such criteria pass plan draft and strand every implement run at
`blocked` when the agent honestly cannot satisfy them. Reject them at draft time instead.

## Decisions

- Non-human-only ACs must be verifiable from the implement worktree with no network and no GitHub — rules out leaving PR/CI/review/network assertions as automated criteria.
- Unsatisfiable AC detection is a **fail** in `validateDraftOutput` (blocks `plan: draft` commit) — rules out warn-only severity like structural ACs, which do not strand implement runs.
- Classifier lives in `shared/spec-parser.ts`, emitting warning kind `unsatisfiable-acceptance-criterion`; `validateDraftOutput` maps that kind to `valid: false` — rules out a plan-only duplicate classifier diverging from patch-mode parsing.
- Human-only criteria (trailing `(Manual)`, `visual inspection only`, `no automated guard`) are exempt — rules out blocking legitimate post-merge human verification of CI or PR state.
- Heuristic patterns cover PR body/title, CI status/checks, review/ready state, and other GitHub/network-only assertions; exact token list pinned at implementation — rules out requiring the implement agent to tick them.
- Rule ships in `prompts/plan/draft.md` and a new `#### Agent-verifiable acceptance criteria` subsection under `## Behavioral acceptance criteria` in `v1/docs/spec-guidance.md` (same surfaces as the failing-test rule) — rules out prompt-only without durable operator guidance.
- PR-body evidence belongs in publication/`prNarrative`, not agent-tickable ACs — rules out criteria like "PR body states the test-count diff."
- Failing-test and agent-verifiable rules are complementary: one requires obtainable evidence (a runnable test), the other forbids demanding evidence the agent cannot produce — rules out weakening either when both apply.
- `criteria-ticked` completion contract unchanged — rules out relaxing implement completion semantics.
- `plan.prompt.draft` revision bumps to 11; rendered snapshot fixture moves to `plan.prompt.draft@r11.shared.txt`.
- Deferred to first consumer: v2 plan-draft shape contract enforcing unsatisfiable AC rejection — pin when v2 wires `validateDraftOutput` or equivalent full subspec validation.

## Task checklist

- [ ] Add `isUnsatisfiableAc` (or equivalent) and `unsatisfiable-acceptance-criterion` warning emission in `shared/spec-parser.ts`; exempt human-only criteria.
- [ ] Map `unsatisfiable-acceptance-criterion` to hard failure in `validateDraftOutput` (`v1/src/modes/plan/draft.ts`).
- [ ] Add the agent-verifiable rule bullet to `prompts/plan/draft.md` adjacent to the failing-test rule.
- [ ] Add `#### Agent-verifiable acceptance criteria` to `v1/docs/spec-guidance.md` with good/bad examples (PR-body/CI/review assertions vs worktree-verifiable outcomes; human-only escape hatch).
- [ ] Add operator-runbook recovery: a spec whose non-human-only AC asserts CI or PR state strands implement runs at `blocked`; fix the spec (edit AC or mark human-only), do not re-run hoping the agent can tick it.
- [ ] Update `v2/docs/v1-behaviors.md` draft-validation bullet with unsatisfiable-AC fail severity.
- [ ] Update `v1/docs/plan-mode.md` draft-validation section with unsatisfiable-AC fail rule.

## Acceptance criteria

- [ ] `validateDraftOutput` returns invalid when a generated subspec carries a non-human-only AC asserting PR body/title, CI status, review/ready state, or another GitHub/network-only fact; human-only markers exempt the same text.
- [ ] A regression test in `shared/spec-parser.test.ts` classifies representative unsatisfiable vs satisfiable AC text and fails against the pre-fix code.
- [ ] A regression test in `v1/test/plan-draft-hard-error-continue.test.ts` (or `v1/test/modes/plan/spec-dir.test.ts`) drives `validateDraftOutput` to invalid on an unsatisfiable AC subspec and fails against the pre-fix code.
- [ ] The rendered plan-draft prompt (`buildDraftPrompt`) states that every non-human-only AC must be verifiable from the implement worktree without network or GitHub; PR-body evidence belongs in publication, not ACs.
- [ ] A new assertion in `v1/test/modes/plan/prompts.test.ts` fails against the pre-change prompt and passes after it, covering the agent-verifiable rule above.
- [ ] `v1/docs/spec-guidance.md` documents the agent-verifiable rule with examples; `v1/docs/operator-runbook.md` documents blocked-run recovery via spec fix, not re-run.
- [ ] `plan.prompt.draft` revision is bumped and the rendered-snapshot suite (`v1/test/prompts/rendered-snapshots.test.ts`) is green against the new fixture.

## Documentation updates

- `v1/docs/spec-guidance.md` — `#### Agent-verifiable acceptance criteria` under behavioral ACs.
- `v1/docs/operator-runbook.md` — unsatisfiable AC stranded-at-blocked recovery (fix spec, not re-run).
- `v1/docs/plan-mode.md` — draft-validation unsatisfiable-AC fail rule.
- `v2/docs/v1-behaviors.md` — extend draft-validation-order entry with unsatisfiable-AC rejection.
- `v1/docs/prompt-governance.md` — only if the revision-bump listing needs it.

## Out of scope

- Changing `criteria-ticked` or human-only completion semantics.
- v2 plan-draft mechanical enforcement until v2 adopts full subspec validation.
- Review-pass re-validation of unsatisfiable ACs (same boundary as existing structural validation: draft-time only).
