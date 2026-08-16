# Initialize machine and project state

## Problem

- v2 cannot configure its machine and current project from the target repository root, so operators combine hand edits with a v1 setup path that writes unrelated state.

## Decisions

- Setup is non-interactive and accepts `--profile`, `--name`, `--target-dir`, and `--scaffold` from resolved cwd; rules out a wizard, path prompts, relocation, and the v1 setup path.
- When `agents` is absent, write the available members of `claude`, `codex`, `cursor` in that order and refuse when none resolve on `PATH`; rules out unavailable defaults and inferred alternatives.
- When `machineProfile` is absent, require `--profile` naming a file in the Jarvis checkout's committed machine-profile directory; rules out guessing or target-repository lookup.
- An existing `machineProfile` is authoritative, and a different supplied profile is refused before writes; rules out using setup as an overwrite operation.
- The project key is `--name` or cwd basename, and `root` is resolved cwd; rules out deriving identity from remote metadata.
- A project key already bound to another root is refused before writes with both roots named; rules out silent registry repointing.
- Add a discovered `origin` only when the selected project has no stored origin; rules out requiring an origin to finish setup or refreshing an existing value.
- Write `--target-dir` only to `projects.<key>.plan.targetDir`, while omission leaves the existing `spec` fallback implicit; rules out materializing a default or writing `modes.plan.targetDir`.
- Resolve the scaffold directory from the explicit value, stored project value, then `spec`; rules out scaffolding a separate hard-coded location.
- Repository scaffolding is opt-in and limited to `<targetDir>/seeds/.gitkeep` and `<targetDir>/ready-intents/.gitkeep`; rules out ordinary-setup writes, runbooks, and guidance files.
- Merge into the existing JSON document and selected project object without rewriting bytes when effective state is unchanged; rules out schema normalization and churn of unrelated keys, projects, or project fields.
- Setup writes only `agents`, `machineProfile`, and `projects.<key>.{root,origin,plan.targetDir}`; rules out v1-only `siblings`, `modes.*`, and changes to `jarvis1 init`.

## Tasks

- Add an init handler with strict argument parsing, committed-profile discovery, executable and origin probes, merge-preserving config writes, optional queue scaffolding, and injectable dependencies for isolated tests.
- Add regression coverage for fresh setup, preservation, refusals, no-origin setup, scaffolding, and byte-stable reruns without reading ambient home, profiles, `PATH`, remotes, or background-process state.
- Add in-body mutation directives to the named pinning tests for the headline setup path and every added refusal, preservation, and write-boundary guard; use unique production anchors and no production invert hooks.
- Update the durable setup, registry-ownership, and v1-parity documentation named below.

## Acceptance criteria

- [ ] From isolated machine and profile directories, setup with `--profile home` and only `claude` available writes ordered agents, the profile, and the selected cwd project with resolved root and discovered origin; a second run reports configured state and leaves config and repository bytes unchanged. `v2/src/commands/init.test.ts` — `fresh init configures the machine and project idempotently`; fails against the pre-fix code.
- [ ] `v2/src/commands/init.test.ts` — `fresh init configures the machine and project idempotently`; Keystone checkpoint: its body carries one `// @mutate` directive that removes the headline setup write, and the mutation turns the named pin RED.
- [ ] Existing agents, profile, project origin, unrelated top-level keys, other projects, and unrelated selected-project fields remain unchanged while requested missing v2 state is added. `v2/src/commands/init.test.ts` — `existing config is merge-preserved`; fails against the pre-fix code.
- [ ] Missing profile selection, conflicting or unknown profiles, no available default candidate, and a project key bound to another root each exit `1` before writes with actionable diagnostics; profile errors list committed choices and root conflicts name both roots. `v2/src/commands/init.test.ts` — `unsafe setup states fail before mutation`; fails against the pre-fix code.
- [ ] Setup without an origin still writes the remaining state, while an existing selected-project origin is retained on rerun. `v2/src/commands/init.test.ts` — `origin discovery is additive and optional for setup`; fails against the pre-fix code.
- [ ] Setup with `--target-dir v2/spec --scaffold` writes the project target directory and creates only `v2/spec/seeds/.gitkeep` and `v2/spec/ready-intents/.gitkeep`; setup without `--scaffold` does not change the repository tree. `v2/src/commands/init.test.ts` — `scaffold writes only queue sentinels`; fails against the pre-fix code.
- [ ] `v2/src/commands/init.test.ts` — `setup guard inversions expose unsafe changes`; Mutation checkpoint: its body carries distinct `// @mutate` directives for every added refusal, preservation, idempotence, and repository-write guard, negative cases assert suppressed writes remain absent, and each mutation turns the named pin RED.
- [ ] `v2/docs/install-and-config.md` makes setup the primary machine/project configuration path while retaining hand-edit schema tables; `v2/docs/operator-runbook.md` assigns v2 project registration to setup; `v2/docs/v1-behaviors.md` records v2 ownership while retaining the v1 behavior as maintenance-only.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/install-and-config.md` — document setup, merge/idempotence semantics, project fields, target-directory selection, and optional scaffolding; retain hand-edit schema reference.
- `v2/docs/operator-runbook.md` — replace v1 project registration ownership with v2 setup.
- `v2/docs/v1-behaviors.md` — distinguish v2 setup ownership from maintenance-only `jarvis1 init`.
