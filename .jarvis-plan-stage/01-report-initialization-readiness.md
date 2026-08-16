# Report initialization readiness

## Problem

- Setup does not prove that required workflow prerequisites are usable, and v2 has no read-only way to diagnose them before admission.

## Prerequisites

- Implement after the init handler and setup state from [00 - Initialize machine and project state](./00-initialize-machine-and-project-state.md); rules out duplicating setup reads and writes inside the readiness evaluator.

## Decisions

- Successful setup runs the same evaluator and renderer as `--check`; rules out divergent setup and diagnostic results.
- Emit exactly one stdout line, in declared order, for Bun, GitHub authentication, supported agent availability, committed profile resolution, cwd registration, origin, effective spec directory, and keyed background-service state; rules out aggregation and deferred readiness failures.
- Each line carries `ok`, `missing`, or `warn`; rules out exit status or stderr as the only readiness signal.
- Bun, GitHub authentication, at least one supported agent, profile resolution, cwd registration, and origin are required; rules out admitting a machine that cannot execute or publish workflows.
- Origin readiness probes the current repository, while setup persistence remains additive and preserves a stored origin; rules out stale registry metadata satisfying publication readiness.
- Missing background-service state or spec directory is a warning and does not fail the report; rules out requiring eager service startup or pre-created planning directories.
- `--check` resolves key, profile, and target directory from explicit selectors before configured values and the `spec` fallback, but selectors do not establish missing configured profile or registration; rules out implicit repair.
- `--check` writes no config, scaffold, or repository bytes and rejects `--scaffold`; rules out a diagnostic mode with side effects.
- Only a required non-`ok` result makes the final exit status `1`; rules out warnings failing setup or checks being reported without process semantics.

## Tasks

- Add one readiness evaluator and renderer shared by post-setup reporting and `--check`, with injected executable, GitHub-auth, profile, registry, origin, directory, and background-service probes.
- Extend init parsing for read-only mode and selector precedence, including early rejection of incompatible options.
- Add isolated regressions for report completeness and order, required versus warning outcomes, selector resolution, missing config, and byte-for-byte read-only behavior.
- Add in-body mutation directives to the named pinning tests for the headline report and every requiredness, warning, selector, and no-write guard; use unique production anchors and no production invert hooks.
- Update the durable preflight and session-start documentation named below.

## Acceptance criteria

- [ ] Setup and `jarvis init --check` each report Bun, GitHub authentication, supported agents, committed profile resolution, cwd registration, origin, effective spec directory, and keyed background-service state exactly once and in order, with every line labeled `ok`, `missing`, or `warn`. `v2/src/commands/init.test.ts` — `setup and check share the complete readiness report`; fails against the pre-fix code.
- [ ] `v2/src/commands/init.test.ts` — `setup and check share the complete readiness report`; Keystone checkpoint: its body carries one `// @mutate` directive that removes shared report evaluation from one path, and the mutation turns the named pin RED.
- [ ] Missing Bun, GitHub authentication, supported agents, resolved profile, cwd registration, or the current repository's origin exits `1`, while missing spec directory or stopped background service alone exits `0`; post-setup report failure retains safely written setup state. `v2/src/commands/init.test.ts` — `readiness distinguishes required checks from warnings`; fails against the pre-fix code.
- [ ] `jarvis init --check` uses `--name`, `--profile`, and `--target-dir` as read-only selectors, falls back to configured values and then `spec` where applicable, and still reports missing configured profile or registration when selectors merely identify those checks. `v2/src/commands/init.test.ts` — `check selectors do not establish setup state`; fails against the pre-fix code.
- [ ] `jarvis init --check` leaves config and repository bytes unchanged, creates no scaffold, rejects `--scaffold`, and exits `0` only when all required checks pass. `v2/src/commands/init.test.ts` — `check mode is strictly read-only`; fails against the pre-fix code.
- [ ] `v2/src/commands/init.test.ts` — `readiness guard inversions expose false admission`; Mutation checkpoint: its body carries distinct `// @mutate` directives for every added requiredness, warning, selector, and no-write guard, negative cases assert suppressed writes remain absent, and each mutation turns the named pin RED.
- [ ] `v2/docs/install-and-config.md` defines report checks and exit semantics, `v2/docs/first-workflow-walkthrough.md` routes prerequisites through setup and `--check`, and `v2/docs/operator-runbook.md` uses `--check` for session-start readiness.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/install-and-config.md` — document the shared report, check classifications, read-only selectors, and exit semantics.
- `v2/docs/first-workflow-walkthrough.md` — replace manual prerequisite assembly with setup and check invocations.
- `v2/docs/operator-runbook.md` — replace hand-edited session-start checks with the read-only readiness report.
