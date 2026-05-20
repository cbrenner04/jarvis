# 01 - Reject unknown project keys in validateConfig

## Problem

`validateConfig` in `src/config.ts` reads a fixed set of keys off each project object (`root`, `origin`, `git`, `siblings`, `plan`) and silently ignores anything else. A misconfiguration that places `specTimestamp` and `commit` directly on a project (instead of nested under `plan`) is accepted without error, dropped from the in-memory config, and re-emitted by `jarvis config show` without the flat fields — making the symptom ("config show does not show my plan overrides") much harder to diagnose than it should be. Other typos (e.g. `oringn`, `siblngs`) behave the same way.

A strict-keys validator catches the original failure mode at the point the user runs any jarvis command, with a clear error message that names the offending key and its likely intended location.

## Scope and decisions

- Tighten `validateConfig` to reject unknown keys **on each project object only**. Out of scope: tightening unknown-key handling at the top level or under `modes`. Keep those permissive for now; project objects are the surface the user is most likely to hand-edit.
- Allowed project keys (the strict allow-list) are exactly: `root`, `origin`, `git`, `siblings`, `plan`. The allow-list lives next to `validateConfig` in `src/config.ts`, not exported, to keep the schema source of truth in one file.
- Allowed `project.plan` keys are exactly: `specTimestamp`, `commit`. Reject anything else under `plan` with a project-scoped error message.
- The error message must name the project, the offending key, and (when it matches a known top-level mode-plan flag) hint at the correct nesting. Example: `project "jarvis": unknown key "specTimestamp"; did you mean "plan.specTimestamp"?`. The hint is only added for the two known mis-nestings (`specTimestamp`, `commit`); other unknown keys get a plain `unknown key "<name>"` message listing the allowed set.
- Error severity matches existing `fail(file, ...)` calls in `validateConfig`: the validator throws via `fail`, so every command that calls `loadConfig` (which is every command) will surface the error and exit non-zero. This is a deliberately breaking validation tightening; users with this misconfiguration will see a real error and must fix the file.
- `jarvis config edit` already re-validates after the editor exits (src/commands/config.ts:264-268). The new strict-key error will surface there too, which is the desired behavior.
- Migration / forward-compat: no migration is required. Any existing config file affected by this change is, by definition, already broken — its flat `specTimestamp` / `commit` were never honored. The clear error is the migration aid.
- Out of scope: rejecting unknown keys under `modes.patch`, `modes.plan`, or `agentOrder` entries. Those have their own validators with looser semantics for now; a follow-up spec can tighten them if needed.

## Task Checklist

- [ ] Add a strict-keys check inside the project loop in `validateConfig` that runs after parsing the known fields and before assigning to `projects[name]`. Reject any unknown key with a clear `fail(file, ...)` message.
- [ ] Add a strict-keys check inside the `planRaw` branch that rejects any unknown key under `project.plan`.
- [ ] Add the targeted "did you mean `plan.specTimestamp`?" hint for the two known mis-nestings (`specTimestamp`, `commit`) at the project level; other unknown keys get a plain message that lists the allowed set.
- [ ] Add tests covering: (a) flat `specTimestamp` at project level produces the hint-augmented error; (b) flat `commit` at project level produces the hint-augmented error; (c) other unknown project keys (e.g. `oringn`) produce the plain unknown-key error listing the allowed set; (d) unknown keys under `project.plan` (e.g. `comit`) produce a `plan`-scoped error; (e) a config with no unknown project keys still parses.
- [ ] Manually run `jarvis config show` against a config file that contains a flat `specTimestamp` on a project and confirm the new error names the project, the key, and the suggested nesting.

## Acceptance criteria

- [ ] A config with `projects.<name>.specTimestamp` (flat) causes `loadConfig` to throw a validation error whose message names the project, the offending key, and suggests `plan.specTimestamp`.
- [ ] A config with `projects.<name>.commit` (flat) causes `loadConfig` to throw a validation error whose message names the project, the offending key, and suggests `plan.commit`.
- [ ] A config with any other unknown key on a project object (e.g. `projects.<name>.oringn`) causes `loadConfig` to throw a validation error that names the project, the offending key, and lists the allowed set (`root, origin, git, siblings, plan`).
- [ ] A config with an unknown key under `projects.<name>.plan` (e.g. `projects.<name>.plan.comit`) causes `loadConfig` to throw a validation error scoped to `plan` that names the offending key and lists the allowed set (`specTimestamp, commit`).
- [ ] A correctly-shaped config (project keys ⊆ allowed set, plan keys ⊆ allowed set) still parses without error.
- [ ] `jarvis config show`, `jarvis config edit`, and any other command that goes through `loadConfig` surface the new validation error and exit non-zero when the config is malformed.
- [ ] `bun run typecheck` passes.
- [ ] `bun test` passes.

## Documentation updates

- Update `docs/config.md` (the project schema section) to call out that project objects use a closed set of keys and that unknown keys are now an error. Show the correct nesting of `plan.specTimestamp` and `plan.commit` explicitly so misreaders of the README example land on the right shape.
- Add a one-line note to the troubleshooting / common-pitfalls section (or to the relevant project-config section if no troubleshooting section exists) that flat `specTimestamp` / `commit` on a project is invalid and lives under `plan`.
