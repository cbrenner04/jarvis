# 01 — `specs` in pipeline chained stages and implement admission, default flip

`chainedStageEffectivePublishGit` in `v2/src/daemon/pipeline-chained-workflow-deps.ts` and `planSourcePublishesExternally` in `v2/src/execution/implement-workflow-steps.ts` still read `git`/`plan.commit`. Route both through the subspec 00 resolver, and flip its absent-`specs` default from `"repo"` to `"external"` now that every spec-home site agrees.

## Decisions

- Both sites call the subspec 00 resolver and surface its validation error; rules out local legacy reads that would disagree with intent/plan.
- The resolver's absent-`specs` default flips from `"repo"` to `"external"` in this subspec, applying globally (intent/plan included) since every site now shares one resolver; rules out a lingering per-site default disagreement.
- Implement admission drops its project-only, strict `git === false` or `plan.commit === false` predicate for the shared resolver; a project without `specs` is external; rules out keeping implement's stricter, machine-unaware semantics.
- No machine-level `specs` override exists; rejecting `modes.plan.commit` removes the machine dimension entirely rather than replacing it; rules out inventing a new machine-level `specs` key nothing in the intent asked for.

## Acceptance criteria

- [ ] `v2/src/daemon/pipeline-chained-workflow-deps.test.ts` asserts a project without `specs` resolves external and one with `specs: "repo"` resolves repo; it fails against the pre-fix code.
- [ ] `v2/src/execution/implement-workflow-steps.test.ts` asserts external plan admission for a project without `specs` and a validation error naming `specs` when `plan.commit` is present; it fails against the pre-fix code.
- [ ] A test asserts `publication-workflow-steps.ts`'s intent/plan sites also default to external once this subspec lands (the flip applies globally through the shared resolver); it fails against the pre-fix code.
- [ ] Existing `pipeline-chained-workflow-deps.test.ts`, `pipeline-stage-resolve.test.ts`, and `implement-workflow-steps.test.ts` fixtures using `plan.commit` or `git: false` as the spec home are rewritten to `specs`, not deleted.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.
- [ ] (Manual) `~/.jarvis/config.json` gains `specs: "repo"` on the `jarvis`, `chess-mvp-yolo`, `chess-mvp-yolo-2`, and `sudoku` project entries, preserving their in-repo spec home across the default flip.
- [ ] (Manual) Committed `config/machines/*.json` files are checked for `modes.plan.commit`; none exist today, and any found are removed since the key is rejected.

## Documentation updates

- `v2/docs/install-and-config.md` — flip the documented default to `"external"` now that every site routes through the resolver.
- `v2/docs/v1-behaviors.md` — record implement admission's default flip to external.
- `v2/docs/workflow-runner.md` — update the `resolveImplementSpecIdentity`/implement-admission paragraph to `specs`.
- `v2/docs/operator-runbook.md` — replace the `plan.commit`/`git` precedence mentions (chained pipeline continuing into implement, chained intent→plan) with `specs`.
- `v2/docs/daemon-host.md` — update the external ready-intent downstream-input resolution mention to `specs`.
- `v2/docs/write-behavior.md` — update the planSource-publishes-externally archival predicate mention to `specs`.
