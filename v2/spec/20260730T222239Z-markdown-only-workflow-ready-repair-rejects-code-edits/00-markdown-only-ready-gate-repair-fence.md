# Markdown-only ready-gate repair fence

Intent and plan workflows publish Markdown only. Ready-gate repair on those workflows must not commit
source, script, or test edits even when the existing run-diff fence would allow them.

## Prerequisites

- Ready-gate repair completion validates staged paths against the run diff plus spec tree before commit.

## Decisions

- Classify markdown-only workflows from the originating write-step identity (original `promptId`,
  frozen landing kind, or equivalent durable parent context) — not the repair iteration's
  `write.ready-repair` id, which overwrites `promptId` during repair. Markdown-only when originating
  `promptId` is `intent.prompt.split` or `plan.prompt.draft` (equivalently `intent-stage` /
  `plan-tree` landing) — rules out role-only or repair-time `stepId` inference.
- Sidecar exclusion (`.jarvis-*` paths) is owned by the sibling
  `ready-gate-repair-omits-jarvis-sidecars-from-commits` intent; this spec covers source/script/test
  non-markdown paths only.
- Apply the markdown-only fence after the existing run-diff+spec-tree allowset: every staged repair
  path must pass both, evaluated in that order — rules out replacing the prior fence.
- Allowed repair paths on markdown-only workflows are exactly repository-relative paths under frozen
  markdown output roots that end in `.md` — rules out agent judgment about harmless non-Markdown fixes
  in the run diff.
- Intent output roots: durable `ready-intents/` (from `intent-stage` landing `output.durableDir`) plus
  `.jarvis-intent-stage/` when the landing/repair-input contract includes it at freeze time — rules
  out worktree-wide `**/*.md`.
- Plan output roots: landed spec-tree directory (from `plan-tree` landing `durablePath`) plus
  `.jarvis-plan-stage/` when the landing/repair-input contract includes it at freeze time — rules out
  allowing edits anywhere under `v2/spec/`.
- Staging roots are frozen from landing/repair-input contract at first repair freeze — not re-derived
  from on-disk presence at enforcement time, and not dropped if the staging dir is removed post-landing
  while paths remain in the run diff.
- Persist markdown output roots (or an equivalent pre-intersected allowset) at first repair freeze
  alongside existing `ReadyGateRepairFenceProvenance` data.
- Markdown-only violations use a dedicated error prefix/message (non-`.md` or path outside frozen
  roots), separate from the run-diff fence wording. First offender is byte-sorted and escaped like the
  existing fence — rules out reusing run-diff messages for markdown-only failures.
- Rejection stays `completion_commit_failed` — rules out a new terminal outcome kind.
- Surface-class regressions use repo-accurate paths: source `v2/src/**`, script `scripts/**`, test
  `v1/test/**` — rules out unpinned `test/**` fixtures.
- Plan workflow shares the classifier and fence; one focused plan-root regression proves
  `durablePath` / `.jarvis-plan-stage/` wiring — rules out assuming intent fixtures exercise plan
  roots.

## Work

- Narrow ready-gate repair completion validation for markdown-only workflows to `.md` paths under
  frozen output roots; persist roots at first freeze.
- Extend the repair-fence test harness (`runRepairFenceLoop`) with intent-shaped inputs: originating
  `promptId` (`intent.prompt.split` or `plan.prompt.draft`), `expectedArtifactPath`
  (`.jarvis-intent-stage` or `.jarvis-plan-stage`), spec path under `ready-intents/` or landed spec
  tree, and frozen landing metadata (`output.durableDir`, `durablePath`, staging dir) — mirroring
  `write.test.ts` and `workflow-runner.test.ts`.
- Add `write-loop.test.ts` intent-workflow regressions for the three rejection classes, allowed-Markdown
  positive path, and one plan-workflow rejection proving frozen `durablePath` enforcement.
- Document the prohibition in operator-facing write behavior and the v1 parity catalog.

## Acceptance criteria

- [ ] `write-loop.test.ts` test `rejects ready-gate repair staging a source-path edit on intent workflow`
      returns `completion_commit_failed` with the markdown-only error prefix before repair republish,
      names the staged `v2/src/**` path, leaves `publishCalls` at one and records no repair commit,
      and fails against the pre-fix baseline.
- [ ] `write-loop.test.ts` test `rejects ready-gate repair staging a script-path edit on intent workflow`
      returns `completion_commit_failed` with the markdown-only error prefix before repair republish,
      names the staged `scripts/**` path, leaves `publishCalls` at one and records no repair commit,
      and fails against the pre-fix baseline.
- [ ] `write-loop.test.ts` test `rejects ready-gate repair staging a test-path edit on intent workflow`
      returns `completion_commit_failed` with the markdown-only error prefix before repair republish,
      names the staged `v1/test/**` path, leaves `publishCalls` at one and records no repair commit,
      and fails against the pre-fix baseline.
- [ ] `write-loop.test.ts` test `rejects ready-gate repair staging a source-path edit on plan workflow`
      returns `completion_commit_failed` naming a staged non-markdown path outside frozen
      `durablePath` / `.jarvis-plan-stage/` roots, leaves `publishCalls` at one and records no repair
      commit, and fails against the pre-fix baseline.
- [ ] `write-loop.test.ts` test `completes ready-gate repair limited to markdown under intent output roots`
      finishes `complete` through the existing bounded repair loop and fails when the markdown-only
      fence is inverted.
- [ ] `write-loop.test.ts` test `rejects ready-gate repairs outside the run diff and spec tree` stays green
      (implement workflows unchanged).
- [ ] Inverting only the markdown-only fence makes all three intent surface-class rejection regressions
      red.
- [ ] `v2/docs/write-behavior.md` documents the markdown-only repair prohibition (originating workflow
      identity, frozen output roots, `.md` suffix, evaluation order, error prefix, failure boundary,
      coexistence with the run-diff fence).
- [ ] `v2/docs/v1-behaviors.md` carries the parity entry for the markdown-only repair restriction.

## Documentation updates

- `v2/docs/write-behavior.md` — markdown-only workflow ready-gate repair prohibition (originating
  workflow identity, frozen output roots, `.md` suffix, evaluation order, dedicated error prefix,
  failure boundary, coexistence with the run-diff fence).
- `v2/docs/v1-behaviors.md` — parity entry for the markdown-only repair restriction on intent/plan
  workflows.
