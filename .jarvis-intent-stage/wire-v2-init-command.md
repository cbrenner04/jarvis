---
name: wire-v2-init-command
---

# Expose `jarvis init` with runnable-state preflight

## Prerequisites

- Init-state persistence fills an absent agent order from supported CLIs on `PATH` without replacing an existing order.
- Init-state persistence requires a known committed machine profile only when `machineProfile` is absent and preserves an existing profile.
- Init-state persistence idempotently registers the resolved current repository, rejects key-to-root collisions, preserves unrelated config, and records optional origin and plan target directory values.
- Init-state persistence scaffolds only the two spec queue `.gitkeep` files when explicitly requested and otherwise leaves the repository untouched.

## Surface

- CLI: top-level command registration, argument admission, stdout/stderr contract, preflight checks, and operator documentation.

## Problem

- Operators must hand-edit v2 config or invoke the v1 initializer, and no command verifies that the current repository is runnable before a workflow fails.

## Decisions

- Register non-interactive `jarvis init [--name <key>] [--profile <name>] [--target-dir <dir>] [--scaffold] [--check]` in the command tree and top-level dispatcher — rules out a wizard or hidden command.
- A normal invocation applies the init-state operation and then always prints the preflight report; an already configured rerun reports that state without mutation — rules out separate setup and validation commands.
- `--check` runs only preflight and performs no config or repository writes — rules out check-mode repair or scaffolding side effects.
- Print one stdout line per check with `ok`, `missing`, or `warn` for Bun, GitHub CLI authentication, configured agent CLI availability, committed machine-profile resolution, current-project registration, `origin`, resolved spec directory, and daemon status — rules out an opaque aggregate result.
- Require Bun, successful `gh auth status`, at least one configured agent CLI on `PATH`, a resolvable committed profile, current-project registration, and `origin`; treat only a missing spec directory or stopped daemon as warnings — rules out declaring an unrunnable checkout ready while preserving optional daemon/spec setup.
- Resolve profiles from the Jarvis checkout and daemon state through existing v2 seams, with injectable command/check runners for deterministic tests — rules out target-cwd profile lookup and live external dependencies in tests.
- Keep `jarvis1 init` unchanged and write only v2 keys — rules out v1 migration or `siblings`/`modes.*` compatibility writes.

## Acceptance criteria

- [ ] `jarvis help` and dispatch expose `jarvis init`; supported flags reach the init-state service, invalid argument shapes print usage and exit `1`, and no invocation prompts.
- [ ] A normal fresh invocation with temp home/profile/repository fixtures and stubbed executable/git checks lands the expected setup, prints the complete preflight, exits by required-check status, and a second invocation reports already configured with no file diff.
- [ ] `--check` writes nothing and exits `1` when GitHub authentication or current-project registration is missing, then exits `0` when every required check passes even if daemon and spec-directory lines warn.
- [ ] Every preflight check emits exactly one labeled stdout line with `ok`, `missing`, or `warn`; missing `origin` is reported and remains a required failure.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/install-and-config.md` — make `jarvis init` the primary machine/project setup and preflight path while retaining hand-edit schema tables as reference.
- `v2/docs/first-workflow-walkthrough.md` — route prerequisites through `jarvis init` and `jarvis init --check`.
- `v2/docs/operator-runbook.md` — replace the v1 registration session step with v2 init/check usage.
- `v2/docs/onboarding.md` — add v2 initialization to installation/first-run routing.
- `v2/docs/v1-behaviors.md` — mark init as v2-owned while retaining v1 init as maintenance-only fallback behavior.
- `README.md` — update installation, quickstart, and command discovery for `jarvis init`.
