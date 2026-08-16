# Add read-only init checks and selectors

## Problem

- Operators need to run the readiness contract without establishing or repairing machine or project state.

## Prerequisites

- Implement after [03 - Evaluate and render initialization readiness](./03-evaluate-and-render-initialization-readiness.md); rules out a second evaluator or a diagnostic path with different output semantics.

## Decisions

- `--check` uses the shared evaluator and renderer but performs no config, scaffold, or repository writes and rejects `--scaffold` before probing.
- Check selectors are read-only: key is `--name` or cwd basename; profile is `--profile` or stored `machineProfile`; target directory is explicit `--target-dir`, then stored project value, preserved `modes.plan.targetDir`, then `spec`.
- `--name` uses the setup safe-key grammar and `--profile` uses exact committed-profile enumeration; invalid selectors fail without writes.
- A profile selector can identify and resolve the profile probe but cannot establish missing configured `machineProfile`; the report remains required non-`ok`.
- A selector conflicting with stored profile state is rendered as an explicit required non-`ok` profile result, never a ready result. A key selector does not establish a missing cwd registration.
- Missing config, malformed owned paths, absent registration, and all other required report failures remain reportable and exit `1`; selector use never repairs them.

## Tasks

- Extend handler-level init parsing for read-only mode, selector precedence, conflict classification, and early incompatible-option rejection while reusing the shared evaluator.
- Add isolated baseline-failing regressions for read-only bytes, selector precedence, missing state, conflicts, malformed selectors/config, scaffold rejection, and successful checks.
- Add in-body mutation directives to the named pins for the headline check mode and every selector, conflict, no-write, and rejection guard; use unique production anchors and no production invert hooks.
- Update the durable setup and check documentation named below.

## Acceptance criteria

- [ ] Handler-level setup and `--check` invoke the same evaluator and report the shared eight checks once in fixed order; check writes no config or repository bytes, creates no sentinel, and exits `0` only when every required result is `ok`. `v2/src/commands/init.test.ts` — `setup and check share the complete readiness report`; fails against the pre-fix code.
- [ ] `v2/src/commands/init.test.ts` — `setup and check share the complete readiness report`; Keystone checkpoint: its body carries one `// @mutate` directive that removes shared report evaluation from check mode, and the mutation turns the named pin RED.
- [ ] Check resolves valid `--name`, `--profile`, and `--target-dir` selectors before stored values and the legacy/fallback target directory without persisting them; a missing configured profile or registration stays required non-`ok` even when a selector identifies its probe. `v2/src/commands/init.test.ts` — `check selectors do not establish setup state`; fails against the pre-fix code.
- [ ] A selector conflicting with configured profile state, an unsafe key, a non-enumerated profile spelling, malformed owned config, or `--check --scaffold` exits `1` without writes; profile conflict output is explicit and cannot claim readiness. `v2/src/commands/init.test.ts` — `check rejects unsafe or conflicting selectors`; fails against the pre-fix code.
- [ ] `v2/src/commands/init.test.ts` — `check mode guard inversions expose implicit repair`; Mutation checkpoint: its body carries distinct `// @mutate` directives for read-only dispatch, selector precedence, missing-configured-state, profile conflict, selector validation, and scaffold-rejection guards, and each mutation turns the named pin RED.
- [ ] `v2/docs/install-and-config.md` makes `jarvis init` the primary machine/project setup and preflight path, retains hand-edit schema tables, and documents merge/idempotence, profile/agent compatibility, project fields, target-directory precedence, optional contained scaffolding, report identifiers/statuses/exit semantics, and read-only selectors.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/install-and-config.md` — document init setup and `--check` while retaining hand-edit schema tables.
