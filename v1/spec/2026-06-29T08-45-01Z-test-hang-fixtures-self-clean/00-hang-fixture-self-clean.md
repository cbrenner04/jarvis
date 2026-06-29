# Hang fixture self-clean

Watchdog/idle sandbox-unrunnable tests spawn real `*-hang.sh` helpers that can outlive abnormal test exit (`--bail`, watchdog kill, thrown assertion, operator interrupt), leaving CPU-pinning orphans under `jarvis-run-*` and `jarvis-patch-review-parent-*` temp dirs.

## Decisions

- Dual defense: hang scripts self-terminate on parent death or bounded lifetime, and tests reap tracked helper process trees in teardown — rules out relying on only script self-exit or only OS temp-dir cleanup.
- Deferred to first consumer: exact lifetime bound — pin when a caller needs it.
- One shared hang-body wrapper used by `IDLE_HANG_BODY`, `writeIdleHangScript`, `idleHangAgent`, and inline `writeAgentScript('…-hang.sh', …)` bodies — rules out per-file ad hoc self-clean snippets.
- In-scope stall fixtures: `idle-hang.sh`, `agent-only-hang.sh`, and all bodies composed through the shared idle-hang helpers above — rules out fixing only one leak site.
- Leave `emit-then-hang.sh` exempt (early-output-then-stall contract from `test-idle-fixtures-dont-spin`) — rules out changing that fixture's stall semantics.
- Leave `ignore-term.sh` / `hang-agent.sh` exempt (descendant-kill semantics, not idle stall) — rules out weakening SIGTERM-ignoring grandchild fixtures.
- No production watchdog/orphan-reaper changes — rules out harness production-path churn.
- Single subspec — rules out split follow-ups that leave mixed fixture lifecycle models.
- No `v2/docs/v1-behaviors.md` — test-fixture internals only; rules out parity-catalog churn for non-production behavior.

## Tasks

- [ ] Add shared hang self-clean wrapper (parent-death poll and bounded lifetime hook; lifetime value chosen by implementer).
- [ ] Apply wrapper at every in-scope idle/watchdog stall hang site (`IDLE_HANG_BODY`, `writeIdleHangScript`, `idleHangAgent`, `agent-only-hang.sh`, inline `idle-hang.sh` bodies in `run.sandbox-unrunnable.test.ts`, shrink/review idle-hang scripts, `run.test.ts` fix-up hang script).
- [ ] Add shared test helper to register spawned hang-agent PIDs/process trees and kill them from `afterEach` / per-test `finally` cleanup in files that spawn hang fixtures.
- [ ] Add automated coverage that a hang helper exits after parent death and that teardown reaps a still-live helper when the test body aborts early.
- [ ] Run `bun run typecheck` and `bun run test`.
- [ ] Remove any operator-runbook stopgap warning about manually reaping leaked `*-hang.sh` fixture orphans (no-op if none was ever committed).

## Acceptance criteria

- [ ] In-scope hang scripts (`IDLE_HANG_BODY`, `writeIdleHangScript` output, `idleHangAgent` / `agent-only-hang.sh` bodies, shrink/review/run idle-hang scripts, `run.test.ts` fix-up hang script) include parent-death self-terminate behavior.
- [ ] Automated test proves an in-scope hang helper process exits within a short grace window after its spawning parent dies without waiting on harness watchdog kill.
- [ ] Automated test proves hang-fixture teardown kills a still-running helper when the enclosing test aborts before normal agent settle (simulated throw or early exit).
- [ ] `run.sandbox-unrunnable.test.ts` `"idle watchdog timeout fires before iteration timeout when agent emits no output"` stays green.
- [ ] `run.sandbox-unrunnable.test.ts` `"idle watchdog armed by default when idleOutputTimeoutMs unset"` stays green.
- [ ] `run.sandbox-unrunnable.test.ts` `"idle watchdog escalates through agentOrder when fallback rung remains"` stays green.
- [ ] `run.sandbox-unrunnable.test.ts` `"idle watchdog on final rung exits 8 with terminal watchdog-idle-timeout"` stays green.
- [ ] `run.sandbox-unrunnable.test.ts` `"idle abort is not classified as quota and escalates via idle ladder"` stays green.
- [ ] `run.sandbox-unrunnable.test.ts` `"fully idle agent (no output, no file writes) is killed by idle watchdog"` stays green.
- [ ] `run.sandbox-unrunnable.test.ts` `"idle watchdog includes last_file_activity_age_ms in telemetry"` stays green.
- [ ] `run.sandbox-unrunnable.test.ts` `"idle watchdog disabled when idleOutputTimeoutMs is 0"` stays green.
- [ ] `run.sandbox-unrunnable.test.ts` `"watchdog timeout records watchdog_descendants_alive false for agent-only stall"` stays green.
- [ ] `run.sandbox-unrunnable.test.ts` `"watchdog timeout records last_output_age_ms from early output then stall"` stays green (`emit-then-hang.sh` unchanged).
- [ ] `run.sandbox-unrunnable.test.ts` `"watchdog timeout kills SIGTERM-ignoring grandchildren and records pgid telemetry"` stays green (`ignore-term.sh` unchanged).
- [ ] `shrink.sandbox-unrunnable.test.ts` `"idle watchdog timeout fires in shrink phase"` stays green.
- [ ] `review.sandbox-unrunnable.test.ts` `"idle watchdog timeout fires in review debate phase"` stays green.
- [ ] `review.sandbox-unrunnable.test.ts` `"idle watchdog timeout fires in review actuator phase"` stays green.
- [ ] `run.test.ts` `"completion: fix-up idle stall exits 8 terminally without agentOrder escalation"` stays green.
- [ ] `v1/docs/operator-runbook.md` contains no stopgap telling operators to manually reap leaked `*-hang.sh` fixture orphans from killed test runs.
- [ ] `bun run typecheck` passes.
- [ ] `bun run test` passes.

## Documentation updates

- `v1/docs/operator-runbook.md` — remove any stopgap warning about leaked `*-hang.sh` fixture orphans once self-cleaning lands; no new runbook prose if no stopgap exists.
