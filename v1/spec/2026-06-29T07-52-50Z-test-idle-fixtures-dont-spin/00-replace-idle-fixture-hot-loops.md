# Replace idle fixture hot loops

Idle/no-output test agent scripts use `while true; do :; done`, burning a core until the watchdog kills them. Replace with a blocking, no-output primitive; watchdog semantics stay unchanged.

## Decisions

- Silent idle fixtures block with `exec tail -f /dev/null` (or equivalent zero-CPU wait) — rules out `while true; do :; done` hot loops and `sleep infinity` (macOS `/bin/sleep` rejects it).
- Single subspec across all idle-silence fixture sites — rules out per-file follow-ups that leave mixed models.
- Leave `ignore-term.sh` and other descendant-kill hot loops untouched — rules out weakening SIGTERM-ignoring grandchild fixtures in `run.sandbox-unrunnable.test.ts`.
- Leave the early-output-then-stall script's post-output `sleep 60` loop untouched — rules out churn on a non-hot-spin stall that already emitted output.
- No production watchdog or timeout changes — rules out shortening timeouts to mask fixture cost.
- No durable docs — intent: test-fixture internals only; rules out `v2/docs/v1-behaviors.md` churn.

## Tasks

- [ ] Update `IDLE_HANG_BODY`, `idleHangAgent` overrides, `agent-only-hang.sh`, and post-output stall tails in `v1/test/run.sandbox-unrunnable.test.ts`.
- [ ] Update idle-hang scripts in `v1/test/modes/patch/shrink.sandbox-unrunnable.test.ts` and `v1/test/modes/patch/review.sandbox-unrunnable.test.ts`.
- [ ] Update the fix-up idle stall hang script in `v1/test/run.test.ts`.
- [ ] Run `bun run typecheck` and `bun run test`.

## Acceptance criteria

- [ ] Idle-silence fixture bodies (`IDLE_HANG_BODY`, `idle-hang.sh`, `agent-only-hang.sh`, shrink/review `idle-hang.sh` scripts, and the `run.test.ts` fix-up hang script) contain no `while true; do :; done`.
- [ ] `v1/test/run.sandbox-unrunnable.test.ts` idle-output watchdog integration tests stay green.
- [ ] `v1/test/modes/patch/shrink.sandbox-unrunnable.test.ts` `"idle watchdog timeout fires in shrink phase"` stays green.
- [ ] `v1/test/modes/patch/review.sandbox-unrunnable.test.ts` idle watchdog debate and actuator tests stay green.
- [ ] `run.test.ts` `"completion: fix-up idle stall exits 8 terminally without agentOrder escalation"` stays green.
- [ ] `v1/test/run.sandbox-unrunnable.test.ts` `"watchdog timeout kills SIGTERM-ignoring grandchildren and records pgid telemetry"` stays green (descendant-kill fixture unchanged).
- [ ] `bun run typecheck` passes.
- [ ] `bun run test` passes.

## Documentation updates

None.
