# 00 - Snapshot-backed write-run resume

## Problem

- Killed workflow write runs and retryable publication failures are advertised as resumable, but daemon resume spawns them with empty rules, artifact path, and bindings.
- RPC success precedes a `no_binding` failure without agent invocation.
- Paused workflow runs have a separate partial reconstruction path, so admission and operator guidance can disagree.

## Decisions

- Use one snapshot-to-`WriteLoopInput` reconstruction and eligibility result for paused, budget-stopped, killed, and retryable-publication write resumes; rules out status-specific input builders.
- Require the run's snapshot to contain a matching executable write step with non-empty rules, artifact path, agents, and model config; rules out status-only resume eligibility.
- Re-resolve live bindings from the persisted role, agents, and model config while preserving the persisted step contract, including timeout and workflow identity; rules out empty bindings or current-config substitution.
- Return RPC `resume_unsupported` before claim/spawn when reconstruction fails; rules out `{ ok: true }` followed by an execution failure.
- Surface unreconstructible stopped rows as `unsupported_resume_context`, non-retryable, `nextAction: "stop"`; rules out `no_binding` / `fix_config` and resume guidance.
- Derive `list`, `wait`, and CLI `resumable`/error guidance from the same eligibility result used by `resume`; rules out presentation-only status inference.
- Keep `awaiting-human` and `revising` decision flows unchanged; rules out applying write-step reconstruction to human gates.

## Scope

- Extract the shared snapshot reconstruction and eligibility path.
- Admit stopped and retryable-publication write resumes only after successful reconstruction, then spawn with the reconstructed input.
- Apply the eligibility result while composing daemon `list` and `wait` results and their CLI output.
- Cover valid killed/publication resumes and malformed or missing snapshot context.
- Align durable daemon, CLI, recovery, and behavior-catalog docs.

## Acceptance criteria

- [ ] A killed workflow write run resumes with its persisted rules, artifact path, step identity, timeout, agents, and model config, invokes the configured binding, and does not fail `no_binding`.
- [ ] A retryable `completion_commit_failed` or `ready_finalize_failed` workflow write run uses the same snapshot reconstruction before publication/finalization replay.
- [ ] Resume rejects a missing snapshot, missing matching step, non-write role, empty rules, empty artifact path, empty agents, missing model config, or unresolvable binding with `resume_unsupported` before executor spawn.
- [ ] `list` and `wait` report unreconstructible stopped write runs as `unsupported_resume_context`, `retryable: false`, `nextAction: "stop"`, and do not expose them as resumable; CLI output preserves that guidance.
- [ ] `awaiting-human` and `revising` resume tests stay green in `v2/src/daemon/daemon-revise.test.ts` (behavior unchanged).
- [ ] Regression coverage in `v2/src/daemon/daemon-resume.test.ts` kills a snapshot-backed workflow write run, resumes it, and asserts the configured binding receives the persisted contract; the test fails against pre-fix code.
- [ ] `bun run typecheck` and `bun run test:v2` pass.

## Documentation updates

- `v2/docs/daemon-host.md` — snapshot-backed resume admission, eligible write statuses, shared eligibility, and `resume_unsupported` / `unsupported_resume_context` contracts.
- `v2/docs/write-behavior.md` — truthful `run list`, `run wait`, and `run resume` CLI guidance.
- `v2/docs/operator-runbook.md` — replace the daemon-restart workaround and pin completion-publication recovery prerequisites.
- `v2/docs/v1-behaviors.md` — record corrected v2 resume behavior and sources.
