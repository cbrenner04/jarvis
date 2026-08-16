# Add v2 init setup and readiness checks

## Problem

v2 cannot initialize its machine and current-project configuration or verify workflow prerequisites from the target repo root. Operators must combine hand edits with `jarvis1 init`, which writes v1-only state and leaves v2 readiness failures until workflow admission.

## Decisions

- `jarvis init` is one non-interactive CLI command with `--profile`, `--name`, `--target-dir`, `--scaffold`, and `--check`; rules out a wizard, path prompts, and reuse of `jarvis1 init`.
- Missing `agents` resolves the ordered candidates `claude`, `codex`, `cursor` through `PATH` and persists only available CLIs; rules out unavailable defaults and alternate inferred agents.
- Missing `machineProfile` requires a supplied committed profile resolved from the Jarvis checkout; rules out guessing a profile, resolving from the target repo, and overwriting an existing selector.
- Existing `agents`, `machineProfile`, project origin, unrelated top-level keys, other projects, and unrelated selected-project fields are authoritative; rules out init-owned replacement or refresh.
- The project key is `--name` or the cwd basename, and its root is resolved cwd; rules out relocation and implicit names from remote metadata.
- A project key bound to a different root is a hard pre-write conflict naming both roots; rules out silent registry repointing.
- A discovered origin is added only when the selected project has no stored origin; rules out requiring origin for setup and refreshing stored origin on rerun.
- `--target-dir` persists only as `projects.<key>.plan.targetDir`; omission keeps the existing `spec` fallback and rules out materializing a default or writing `modes.plan.targetDir`.
- Target-repo writes are opt-in through `--scaffold` and limited to `<targetDir>/seeds/.gitkeep` plus `<targetDir>/ready-intents/.gitkeep`; rules out guidance files and ordinary-init repo mutation.
- Setup writes only `agents`, `machineProfile`, and `projects.<key>.{root,origin,plan.targetDir}` through merge-preserving JSON replacement; rules out v1-only `siblings`, `modes.*`, and schema normalization.
- Repeated setup with the same effective state does not rewrite config or repo bytes; rules out timestamp, formatting, and scaffold churn.
- Setup always follows with the same eight-check readiness report used by `--check`: Bun, GitHub authentication, supported agent CLI availability, committed profile resolution, cwd registration, origin, effective spec directory, and daemon status; rules out a setup-only success message that defers readiness.
- Each readiness check emits exactly one stdout line labeled `ok`, `missing`, or `warn`; rules out aggregated or stderr-only reporting.
- Bun, GitHub authentication, one supported agent CLI, profile resolution, cwd registration, and origin are required; daemon and spec-directory absence warn, so they do not cause failure.
- `--check` is strictly read-only and treats selectors as lookup inputs rather than setup state; rules out diagnostic repair and selectors satisfying missing persisted profile or registration.
- `--check --scaffold` and invalid operands fail with init usage before mutation; rules out ambiguous partial execution.

## Tasks

- Add the init command's argument parsing, profile discovery, machine/project merge, optional scaffold, and idempotent write behavior using injectable filesystem, executable, git, GitHub-auth, and daemon-status seams.
- Build one readiness evaluator and renderer shared by setup and `--check`, with required/warning exit semantics and read-only selector resolution.
- Register `init` in top-level dispatch, usage, command-tree help, and flag-parity coverage.
- Add isolated command and CLI regressions using temporary config/profile/repo roots and stubbed external checks; tests must not read ambient machine config, `PATH`, GitHub auth, remotes, or daemon state.
- Add in-body mutation directives to the named pinning tests for the headline setup path and every added or modified refusal, preservation, read-only, required-check, and warning guard; use unique landed production anchors and no production invert hooks.
- Update the durable operator documentation named below in the same change.

## Acceptance criteria

- [ ] From an isolated fresh home, `jarvis init --profile home` with only `claude` available writes `agents`, `machineProfile`, and the selected cwd project with resolved root and discovered origin; rerunning reports the configured state and leaves config and repo bytes unchanged. `v2/src/commands/init.test.ts` — `fresh init configures the machine and project idempotently`; fails against the baseline.
- [ ] `v2/src/commands/init.test.ts` — `fresh init configures the machine and project idempotently`; Keystone checkpoint: its test body carries one `// @mutate` directive that reverts the headline setup path to baseline no-setup semantics, and that mutation turns the named pin RED.
- [ ] Init preserves configured `agents`, `machineProfile`, stored project origin, unrelated top-level keys, other projects, and unrelated selected-project fields while adding only missing requested v2 state. `v2/src/commands/init.test.ts` — `existing config is merge-preserved`; fails against the baseline.
- [ ] Missing profile selection, conflicting or unknown profiles, no available default agent CLI, and a project key bound to another root each exit `1` before mutation with actionable diagnostics; profile errors list committed choices and the root conflict names both roots. `v2/src/commands/init.test.ts` — `unsafe setup states fail before mutation`; fails against the baseline.
- [ ] `jarvis init --target-dir v2/spec --scaffold` persists the project target directory and creates only `v2/spec/seeds/.gitkeep` and `v2/spec/ready-intents/.gitkeep`; ordinary init never changes the repo tree. `v2/src/commands/init.test.ts` — `scaffold writes only queue sentinels`; fails against the baseline.
- [ ] Setup and `jarvis init --check` each report Bun, GitHub authentication, supported agent CLIs, committed profile resolution, cwd registration, origin, effective spec directory, and daemon status exactly once with `ok`, `missing`, or `warn`; missing required checks exit `1`, while absent daemon or spec directory alone exits `0`. `v2/src/commands/init.test.ts` — `readiness report distinguishes required checks from warnings`; fails against the baseline.
- [ ] `jarvis init --check` resolves `--name`, `--profile`, and `--target-dir` as read-only selectors, does not treat them as persisted setup, writes no config, scaffold, or repo bytes, rejects `--scaffold`, and exits `0` only when all required checks pass. `v2/src/commands/init.test.ts` — `check mode is selector-aware and strictly read-only`; fails against the baseline.
- [ ] `v2/src/commands/init.test.ts` — `guard inversions expose every init refusal and boundary`; Mutation checkpoint: its test body carries a distinct `// @mutate` directive for every added or modified refusal, preservation, read-only, required-check, and warning guard, including negative assertions that suppressed writes remain absent, and each mutation turns the named pin RED.
- [ ] Top-level dispatch and help expose `init` and all five flags, invalid operands print init usage to stderr and exit `1`, and no init path prompts for input. `v2/src/cli.test.ts` — `init dispatch and help expose the non-interactive contract`; fails against the baseline.
- [ ] `v2/docs/install-and-config.md`, `v2/docs/first-workflow-walkthrough.md`, `v2/docs/operator-runbook.md`, `v2/docs/onboarding.md`, `v2/docs/v1-behaviors.md`, and `README.md` document `jarvis init` as the primary v2 setup/preflight path, preserve hand-edit schema reference, and retain `jarvis1 init` only as maintenance-only v1 behavior.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/install-and-config.md` — make `jarvis init` the primary machine/project setup and preflight path; retain schema and hand-edit details as reference.
- `v2/docs/first-workflow-walkthrough.md` — route prerequisites through setup and check invocations.
- `v2/docs/operator-runbook.md` — move v2 registration ownership and session-start readiness to `jarvis init`.
- `v2/docs/onboarding.md` — include init in installation and first-run routing.
- `v2/docs/v1-behaviors.md` — record v2 init ownership and the maintenance-only v1 distinction.
- `README.md` — align installation, quickstart, configuration, and command inventory.
