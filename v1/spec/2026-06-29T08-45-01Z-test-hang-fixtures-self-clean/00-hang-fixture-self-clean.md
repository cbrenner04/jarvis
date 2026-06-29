# Hang fixture self-clean

Watchdog/idle sandbox-unrunnable tests spawn real `*-hang.sh` helpers that can outlive abnormal test exit (`--bail`, watchdog kill, thrown assertion, operator interrupt), leaving lingering PIDs and file descriptors under `jarvis-run-*` and `jarvis-patch-review-parent-*` temp dirs.

## Prerequisites

- In-scope stall fixtures use blocking `tail -f /dev/null` wait (`test-idle-fixtures-dont-spin` merged or equivalent on branch) — rules out parent-death logic on hot-loop stall bodies.

## Decisions

- Dual defense: script self-clean when per-test teardown may not run (`--bail`, operator interrupt, parallel-file orphans); per-test teardown when the test body aborts normally (throw/early exit), with script self-clean as backup — rules out relying on only `afterEach` or only script self-exit.
- Parent-death required; bounded-lifetime hook present with implementer-chosen bound (unpinned until needed) as backstop when teardown cannot run or cannot see another file's orphans — rules out AC-only parent-death without lifetime hook.
- Deferred to first consumer: exact lifetime bound — pin when a caller needs it.
- Stall wait is `IDLE_HANG_WAIT = "exec tail -f /dev/null"`; self-clean attaches at `IDLE_HANG_WAIT` compose (or equivalent shared compose used by both `IDLE_HANG_BODY` and bare-`WAIT` call sites) so parent-death poll runs before `exec` replaces the shell (e.g., background parent poll then `exec`, or replace `exec` with an equivalent blocking wait that includes poll) — rules out BODY-only snippets that never run at stall time and rules out parent-death logic placed after unreachable `exec`.
- One shared compose/wrapper at `IDLE_HANG_WAIT` used by `IDLE_HANG_BODY`, `writeIdleHangScript`, `idleHangAgent`, `agent-only-hang.sh` (`IDLE_HANG_WAIT` only), and inline `writeAgentScript('…-hang.sh', …)` bodies — rules out per-file ad hoc self-clean snippets.
- Parent-death watch target is the hang script's immediate bash parent (the process that `exec`s or sources the script); parent-death AC is an isolated direct-spawn test (bash parent killed, not full jarvis→agent→tail stack) — rules out satisfying parent-death AC only via harness watchdog kill.
- In-scope stall fixtures: `idle-hang.sh`, `agent-only-hang.sh`, and all bodies composed through the shared idle-hang helpers above — rules out fixing only one leak site.
- Exempt fixtures (`emit-then-hang.sh`, `ignore-term.sh`, `hang-agent.sh`) unchanged; residual orphan risk on abnormal exit accepted — rules out re-litigating exemptions during implementation.
- Teardown registers jarvis/agent child PID or script-path descendant tree; prefer reusing existing test reap patterns (`DescendantTracker`, `__testReapOverride`) where present — rules out parallel ad-hoc kill logic conflicting with harness reapers.
- No production watchdog/orphan-reaper changes — rules out harness production-path churn.
- Single subspec — rules out split follow-ups that leave mixed fixture lifecycle models.
- No `v2/docs/v1-behaviors.md` — test-fixture internals only; rules out parity-catalog churn for non-production behavior.
- Runbook cleanup conditional: remove committed `*-hang.sh` orphan stopgap if present; no new runbook prose — rules out speculative operator warnings.

## Tasks

- [ ] Add shared `IDLE_HANG_WAIT` compose/wrapper (parent-death poll before stall `exec`, plus bounded-lifetime hook; lifetime value chosen by implementer).
- [ ] Apply wrapper at every in-scope idle/watchdog stall hang site: `IDLE_HANG_WAIT` / `IDLE_HANG_BODY`, `writeIdleHangScript`, `idleHangAgent`, `agent-only-hang.sh`, inline `idle-hang.sh` bodies in `run.sandbox-unrunnable.test.ts`, shrink/review idle-hang scripts, `run.test.ts` fix-up hang script.
- [ ] Add shared test helper to register spawned hang-agent PIDs/process trees and kill them from `afterEach` / per-test `finally` in `run.sandbox-unrunnable.test.ts`, `shrink.sandbox-unrunnable.test.ts`, `review.sandbox-unrunnable.test.ts` (including out-of-tree `join(dir, "..", "idle-actuator")/idle-hang.sh` — dir `cleanup()` alone is insufficient), and `run.test.ts`.
- [ ] Add isolated subprocess tests (sandbox-off; `ps`/`pgrep` visibility per runbook) for parent-death exit and teardown reap-on-abort; not full sandbox-unrunnable watchdog runs.
- [ ] Run `bun run typecheck` and `bun run test`.
- [ ] Remove any operator-runbook stopgap warning about manually reaping leaked `*-hang.sh` fixture orphans (no-op if none was ever committed).

## Acceptance criteria

- [ ] In-scope hang scripts (`IDLE_HANG_WAIT` output, `IDLE_HANG_BODY`, `writeIdleHangScript` output, `idleHangAgent` / `agent-only-hang.sh` bodies, shrink/review/run idle-hang scripts, `run.test.ts` fix-up hang script) include parent-death self-terminate behavior wired through the shared `IDLE_HANG_WAIT` compose.
- [ ] Isolated direct-spawn test (`*.test.ts`, sandbox-off): in-scope hang helper exits within `__testKillGraceMs` (200) + headroom after its immediate bash parent is killed, without harness watchdog involvement.
- [ ] Isolated teardown test (`*.test.ts`, sandbox-off): with helper still alive (idle timeout disabled or well above test window), simulated test-body throw/early exit triggers registered teardown that kills the helper within `__testKillGraceMs` + headroom.
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
