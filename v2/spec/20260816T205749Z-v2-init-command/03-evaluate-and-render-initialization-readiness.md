# Evaluate and render initialization readiness

## Problem

- Setup needs a stable, bounded readiness report before workflow admission.

## Prerequisites

- Implement after [00 - Bootstrap machine profile and agent roster](./00-bootstrap-machine-profile-and-agent-roster.md), [01 - Register the current repository](./01-register-current-repository.md), and [02 - Configure and safely scaffold the planning directory](./02-configure-and-safely-scaffold-planning-directory.md); rules out duplicate validation and divergent target-directory resolution.

## Decisions

- One evaluator and renderer, also used by `--check`, emit exactly these single-line identifiers in order: `bun`, `github-auth`, `agents`, `machine-profile`, `project-registration`, `origin`, `spec-directory`, `daemon`.
- Every result is `ok`, `missing`, or `warn`; untrusted probe detail is normalized to one line. Exceptions, timeouts, and multiline subprocess output become that check's result instead of escaping the report.
- Bun, GitHub authentication, every configured profile-bound agent CLI, configured profile resolution, cwd registration, and origin consistency are required. A required non-`ok` exits `1`; absent spec directory and daemon are warnings and alone exit `0`.
- Profile readiness validates the configured roster and bindings together under the same all-configured-agents-runnable rule as bootstrap.
- Origin readiness requires a current `origin` and a stored selected-project origin matching it. A missing or drifted stored origin is non-`ok` and never refreshes registry state.
- All executable, GitHub, Git, profile, directory, and daemon probes have injected bounded runners; daemon is read-only keyed status.
- Successful setup runs this evaluator after durable setup writes, so a readiness failure does not roll back valid setup state.

## Tasks

- Add a shared evaluator, single-line renderer, requiredness classifier, bounded injected probes, and post-setup invocation.
- Add isolated baseline-failing regressions for complete ordered output, probe normalization, profile/agent compatibility, origin drift, required failures, warning-only success, and retained setup after report failure.
- Add in-body mutation directives to the named pins for the headline report and every ordering, requiredness, profile-agent, origin, bounded-probe, and warning guard; use unique production anchors and no production invert hooks.
- Update the durable setup and preflight documentation named below.

## Acceptance criteria

- [ ] Successful setup reports `bun`, `github-auth`, `agents`, `machine-profile`, `project-registration`, `origin`, `spec-directory`, and `daemon` exactly once in that order, with one single line and an `ok`, `missing`, or `warn` status for each. `v2/src/commands/init.test.ts` — `setup renders the complete stable readiness report`; fails against the pre-fix code.
- [ ] `v2/src/commands/init.test.ts` — `setup renders the complete stable readiness report`; Keystone checkpoint: its body carries one `// @mutate` directive that removes shared report evaluation after setup, and the mutation turns the named pin RED.
- [ ] Missing Bun, GitHub authentication, any configured profile-bound executable, resolved configured profile, cwd registration, current origin, or stored-origin match exits `1`; a missing spec directory or stopped daemon alone exits `0`. `v2/src/commands/init.test.ts` — `readiness distinguishes required checks from warnings`; fails against the pre-fix code.
- [ ] Timeout, exception, and multiline probe diagnostics appear only as the corresponding bounded single-line result, and a changed remote origin produces a required non-`ok` origin result without rewriting stored origin. `v2/src/commands/init.test.ts` — `readiness normalizes bounded probes and origin drift`; fails against the pre-fix code.
- [ ] A post-setup required readiness failure retains the safely written configuration and any already-valid scaffold state. `v2/src/commands/init.test.ts` — `setup retains state after readiness failure`; fails against the pre-fix code.
- [ ] `v2/src/commands/init.test.ts` — `readiness evaluator guard inversions expose false admission`; Mutation checkpoint: its body carries distinct `// @mutate` directives for report order, requiredness, configured-agent runnable binding, origin consistency, bounded-probe normalization, and warning guards, and each mutation turns the named pin RED.
- [ ] `v2/docs/first-workflow-walkthrough.md` routes prerequisites through setup and readiness verification; `v2/docs/operator-runbook.md` uses the report for session-start readiness.
- [ ] `bun run typecheck`, `bun run test:v2`, and `bun run test:integration:v2` pass.

## Documentation updates

- `v2/docs/first-workflow-walkthrough.md` — route prerequisites through init and readiness verification.
- `v2/docs/operator-runbook.md` — use the readiness report for session start.
