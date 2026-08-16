# Configure and safely scaffold the planning directory

## Problem

- v2 needs an explicit project planning location and opt-in queue sentinels without path escape or partial setup state.

## Prerequisites

- Implement after [01 - Register the current repository](./01-register-current-repository.md); rules out scaffolding before a valid project root and owned project object exist.

## Decisions

- Target-directory precedence is explicit `--target-dir`, then `projects.<key>.plan.targetDir`, then preserved legacy `modes.plan.targetDir`, then `spec`. Init writes only the project value and never writes `modes.*`.
- An omitted target directory preserves an existing project value and otherwise leaves the fallback implicit. An explicit valid value replaces the selected project's existing `plan.targetDir`.
- A target directory must be relative, non-empty, non-traversing, and lexically inside the project root. `--target-dir` values use the same validation and precedence for setup, scaffolding, readiness, and checks as workflow routing.
- `--scaffold` is the only repository-mutating mode. It creates only `<targetDir>/seeds/.gitkeep` and `<targetDir>/ready-intents/.gitkeep`.
- Before any config or scaffold write, resolve the project root and every existing target ancestor physically. Each resolved ancestor and final parent must stay inside the resolved project root; symlink escape fails without writing sentinels or config.
- Existing sentinels are preserved and never overwritten. Anticipated config or scaffold destination failures are preflighted before either owned destination changes; successfully written setup state remains after a later readiness failure.

## Tasks

- Add handler-level target-directory resolution, owned-plan validation, explicit replacement, physical containment preflight, and atomic sentinel creation with injectable filesystem dependencies.
- Add baseline-failing regressions for precedence, replacement and omission, invalid and symlink paths, existing sentinels, limited writes, and expected-failure atomicity.
- Add in-body mutation directives to the named pins for the headline scaffold and every precedence, containment, write-boundary, overwrite, and atomicity guard; use unique production anchors and no production invert hooks.
- Update the explicit queue-scaffolding architecture documentation named below.

## Acceptance criteria

- [ ] Handler-level init with `--target-dir v2/spec --scaffold` replaces any selected-project target directory and creates only `v2/spec/seeds/.gitkeep` and `v2/spec/ready-intents/.gitkeep`; without `--scaffold`, it does not modify the repository tree. `v2/src/commands/init.test.ts` — `scaffold writes only contained queue sentinels`; fails against the pre-fix code.
- [ ] `v2/src/commands/init.test.ts` — `scaffold writes only contained queue sentinels`; Keystone checkpoint: its body carries one `// @mutate` directive that removes the headline sentinel write, and the mutation turns the named pin RED.
- [ ] Omitted `--target-dir` preserves a selected-project value and otherwise uses legacy `modes.plan.targetDir` read-only before `spec`; explicit target directories replace the project value and use the same precedence in setup, scaffold preparation, readiness, and check mode. `v2/src/commands/init.test.ts` — `init target directory precedence matches workflow routing`; fails against the pre-fix code.
- [ ] Absolute, empty, traversing, malformed owned `plan` or `targetDir`, and symlink-escaping target paths exit `1` before config or repository mutation; sentinels can never resolve outside the repository root. `v2/src/commands/init.test.ts` — `scaffold containment rejects lexical and physical escapes`; fails against the pre-fix code.
- [ ] Existing sentinels are not overwritten, and all anticipated config or scaffold failures leave both owned destinations byte-unchanged; a subsequent readiness failure retains otherwise successful setup state. `v2/src/commands/init.test.ts` — `scaffold preflight avoids partial owned state`; fails against the pre-fix code.
- [ ] `v2/src/commands/init.test.ts` — `scaffold guard inversions expose escaping or partial writes`; Mutation checkpoint: its body carries distinct `// @mutate` directives for target precedence, explicit replacement, physical containment, sentinel non-overwrite, no-ordinary-write, and preflight-atomicity guards, and each mutation turns the named pin RED.
- [ ] `v2/docs/v2-architecture.md` narrows the no-project-artifacts rule only for explicit contained queue scaffolding.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/v2-architecture.md` — reconcile explicit contained queue scaffolding with the target-repository artifact boundary.
