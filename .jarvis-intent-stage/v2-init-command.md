---
name: v2-init-command
---

# Initialize a v2 machine and project

## Problem

- v2 cannot configure a machine and target repo from the repo root or verify readiness before workflow admission; the v1 fallback writes unrelated project files and omits v2 configuration.

## Module-boundary surface

- Keep the work in one CLI intent; rules out separate persistence, daemon, or execution-loop intents because `jarvis init` composes existing config, profile, registry, subprocess, and daemon-status contracts without changing those boundaries.
- Splitting does not apply because exactly one module-boundary surface changes.

## Decisions

- Add non-interactive `jarvis init [--profile <name>] [--name <key>] [--target-dir <dir>] [--scaffold] [--check]` from the target repo root; rules out a wizard and the `jarvis1 init` setup path.
- On a missing `agents` key, persist `claude,codex,cursor` in that order after filtering to CLIs found on `PATH`, and fail when none are found; rules out storing unavailable defaults or guessing another agent.
- On a missing `machineProfile`, require `--profile` and accept only a committed `config/machines/<name>.json` resolved from the Jarvis checkout, listing available profiles on omission or mismatch; rules out guessing a profile or resolving profiles from the target repo.
- Preserve existing `agents` and `machineProfile`; rules out using init as an overwrite command.
- Register `projects.<key>` with resolved cwd as `root` and `git remote get-url origin` as `origin` when present, where key is `--name` or the repo basename; rules out relocating the repo under `~/Work` or requiring an origin.
- Refuse a project key already bound to another root and name both roots; rules out silently repointing an existing registry entry.
- Persist `--target-dir` as `projects.<key>.plan.targetDir`; an omitted value leaves planning's existing `spec` fallback unchanged rather than materializing a default config key.
- Write `<targetDir>/seeds/.gitkeep` and `<targetDir>/ready-intents/.gitkeep` only with `--scaffold`; rules out runbooks, guidance files, or any target-repo mutation during ordinary init.
- Preserve unrelated top-level config keys, other project entries, and unrelated fields on the selected project through the established JSON read/merge/write discipline; rules out an init-owned config schema rewrite.
- Re-running an already configured machine/project makes no file change and reports the existing state; rules out churn from idempotent setup.
- After init, print one stdout line per preflight check with `ok`, `missing`, or `warn` for Bun, `gh auth status`, supported agent CLIs on `PATH`, committed machine profile resolution, cwd project registration, origin, effective spec directory, and daemon status; rules out deferring readiness failures to the first workflow.
- Treat Bun, GitHub authentication, at least one agent CLI, profile resolution, project registration, and origin as required; daemon and spec-directory absence are warnings, so only a required non-`ok` check makes exit status `1`.
- Make `--check` run the same report without config, scaffold, or repo writes; rules out a diagnostic command that repairs state implicitly.
- Write only v2 keys: `agents`, `machineProfile`, and `projects.<key>.{root,origin,plan.targetDir}`; rules out v1-only `siblings` and `modes.*` keys or changes to `jarvis1 init`.

## Acceptance criteria

- [ ] From a fresh home, `jarvis init --profile home` with only `claude` available writes `agents`, `machineProfile`, and the cwd project entry with resolved root and discovered origin; a second run reports configured state and leaves both config and repo bytes unchanged. A test uses isolated home/profile directories and stubbed PATH/git checks and fails against the baseline.
- [ ] Against an existing config, init preserves existing `agents`, `machineProfile`, unrelated top-level keys, other projects, and unrelated fields on the selected project while adding only requested setup state; pinned by a failing-baseline test.
- [ ] Missing `--profile` when `machineProfile` is absent, an unknown profile, none of the default candidate agent CLIs when `agents` is absent, and a project key bound to another root each exit `1` without mutation and print actionable diagnostics; profile diagnostics list committed choices and key-conflict diagnostics name both roots.
- [ ] `jarvis init --target-dir v2/spec --scaffold` persists `plan.targetDir` and creates only `v2/spec/seeds/.gitkeep` and `v2/spec/ready-intents/.gitkeep`; without `--scaffold`, init does not modify the repo tree.
- [ ] `jarvis init --check` writes nothing, reports every check once, exits `1` when any required check such as GitHub authentication or registration is missing, and exits `0` when all required checks pass; tests inject check runners and fail against the baseline.
- [ ] Top-level dispatch and help expose `init` and its flags, invalid operands exit `1` with init usage, and no path prompts for input.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/install-and-config.md` — make `jarvis init` the primary machine/project setup and preflight path while retaining hand-edit schema tables as reference.
- `v2/docs/first-workflow-walkthrough.md` — route prerequisites through `jarvis init` and `jarvis init --check`.
- `v2/docs/operator-runbook.md` — replace v1 registration and hand-edit session-start steps with `jarvis init`.
- `v2/docs/onboarding.md` — include `jarvis init` in installation.
- `v2/docs/v1-behaviors.md` — record `init` ownership in v2 while retaining v1 init as maintenance-only behavior.
- `README.md` — update installation, quickstart, configuration, and command inventory for `jarvis init`.

## Prerequisites
