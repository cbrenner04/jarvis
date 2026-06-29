# Replace idle fixture hot loops

Idle/no-output test agent scripts use `while true; do :; done`, burning a core until the watchdog kills them. Replace with a blocking, no-output primitive; watchdog semantics stay unchanged.

## Decisions

- Silent idle fixtures block with `exec tail -f /dev/null` (or equivalent zero-CPU wait) — rules out `while true; do :; done` hot loops and `sleep infinity` (macOS `/bin/sleep` rejects it).
- One shared blocking literal (via `IDLE_HANG_BODY` or equivalent) at every in-scope silent-idle site and inline override — rules out per-file ad hoc primitives (`tail` vs `read` vs `pause`).
- Single subspec across all idle-silence fixture sites — rules out per-file follow-ups that leave mixed models.
- Include the `idle watchdog disabled when idleOutputTimeoutMs is 0` inline `idle-hang.sh` post-output stall (swap hot loop to blocking primitive; emit-then-stall semantics unchanged) — rules out leaving that hot loop while the substring AC forbids it.
- Leave `ignore-term.sh` and other descendant-kill hot loops untouched — rules out weakening SIGTERM-ignoring grandchild fixtures in `run.sandbox-unrunnable.test.ts`.
- Leave `emit-then-hang.sh` untouched (`sleep 60` keepalive after early output, not a silent-idle fixture) — rules out churn on a non-hot-spin stall that already emitted output.
- No production watchdog or timeout changes — rules out shortening timeouts to mask fixture cost.
- No durable docs — intent: test-fixture internals only; rules out `v2/docs/v1-behaviors.md` churn.

## Tasks

- [ ] Update `IDLE_HANG_BODY`, `idleHangAgent` defaults and overrides (including ~L1028 inline string), `writeAgentScript('idle-hang.sh', …)` inline bodies, `agent-only-hang.sh`, and the `idle watchdog disabled when idleOutputTimeoutMs is 0` inline stall tail in `v1/test/run.sandbox-unrunnable.test.ts`.
- [ ] Update idle-hang scripts in `v1/test/modes/patch/shrink.sandbox-unrunnable.test.ts` and `v1/test/modes/patch/review.sandbox-unrunnable.test.ts`.
- [ ] Update the fix-up idle stall hang script in `v1/test/run.test.ts`.
- [ ] Run `bun run typecheck` and `bun run test`.

## Acceptance criteria

- [ ] In-scope hang bodies (`IDLE_HANG_BODY`, `idleHangAgent(...)` defaults and overrides, `writeAgentScript('idle-hang.sh', …)` inline bodies, `agent-only-hang.sh`, shrink/review idle-hang scripts, `run.test.ts` fix-up hang script) contain no `while true; do :; done`.
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
- [ ] `bun run typecheck` passes.
- [ ] `bun run test` passes.

## Documentation updates

None.
