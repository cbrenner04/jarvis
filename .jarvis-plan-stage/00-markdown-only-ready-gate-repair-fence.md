# Markdown-only ready-gate repair fence

Intent and plan workflows publish Markdown only. Ready-gate repair on those workflows must not commit source, script, test, or sidecar edits even when the existing run-diff fence would allow them.

## Decisions

- Classify markdown-only workflows by `promptId` `intent.prompt.split` or `plan.prompt.draft` (equivalently `intent-stage` / `plan-tree` landing) — rules out role-only or `stepId` inference.
- Apply the markdown-only fence after the existing run-diff+spec-tree allowset: every staged repair path must pass both — rules out replacing the prior fence.
- Allowed repair paths on markdown-only workflows are exactly repository-relative paths under the workflow's markdown output roots that end in `.md` — rules out agent judgment about harmless non-Markdown fixes in the run diff.
- Intent output roots: the durable `ready-intents/` tree (from `intent-stage` landing `output.durableDir`) plus `.jarvis-intent-stage/` when present — rules out worktree-wide `**/*.md`.
- Plan output roots: the landed spec-tree directory (from `plan-tree` landing `durablePath`) plus `.jarvis-plan-stage/` when present — rules out allowing edits anywhere under `v2/spec/`.
- Carry publication landing (or equivalent resolved roots) on the write-loop repair input so roots are frozen with the existing allowset — rules out re-deriving roots from the dirty worktree at enforcement time.
- Rejection stays `completion_commit_failed` with a deterministic message naming the first offending path (byte-sorted, escaped like the existing fence) — rules out a new terminal outcome kind.
- Dedicated intent-workflow regressions assert source (`v2/src/**`), script (`scripts/**`), and test (`test/**`) staging separately — rules out one generic non-Markdown case.
- Plan workflow uses the same classifier and fence; no separate plan-only AC — rules out duplicating three surface-class tests for plan when intent exercises the shared guard.

## Work

- Narrow ready-gate repair completion validation for markdown-only workflows to `.md` paths under the frozen output roots.
- Add `v2/src/execution/write-loop.test.ts` intent-workflow fixtures and regressions for the three rejection classes plus the allowed-Markdown positive path.
- Document the prohibition in operator-facing write behavior and the v1 parity catalog.

## Acceptance criteria

- [ ] `write-loop.test.ts` test `rejects ready-gate repair staging a source-path edit on intent workflow` returns `completion_commit_failed` before repair republish, names the staged source path, and fails against the pre-fix baseline.
- [ ] `write-loop.test.ts` test `rejects ready-gate repair staging a script-path edit on intent workflow` returns `completion_commit_failed` before repair republish, names the staged script path, and fails against the pre-fix baseline.
- [ ] `write-loop.test.ts` test `rejects ready-gate repair staging a test-path edit on intent workflow` returns `completion_commit_failed` before repair republish, names the staged test path, and fails against the pre-fix baseline.
- [ ] `write-loop.test.ts` test `completes ready-gate repair limited to markdown under intent output roots` finishes `complete` through the existing bounded repair loop and fails when the markdown-only fence is inverted.
- [ ] `write-loop.test.ts` test `rejects ready-gate repairs outside the run diff and spec tree` stays green (implement workflows unchanged).
- [ ] Inverting only the markdown-only fence makes the source-path rejection regression red.

## Documentation updates

- `v2/docs/write-behavior.md` — markdown-only workflow ready-gate repair prohibition (output roots, `.md` suffix, failure boundary, coexistence with the run-diff fence).
- `v2/docs/v1-behaviors.md` — parity entry for the markdown-only repair restriction on intent/plan workflows.
