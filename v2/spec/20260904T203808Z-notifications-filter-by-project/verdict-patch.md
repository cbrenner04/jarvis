## Verdict

**1. Fix `notifications wait --project` skip-loop re-arm (required).** On a non-matching delivery, advance with the returned `deliveryCursor` as the next `--since` bound (`sinceCursor`), preserving `kinds`. Do not re-arm with `sinceMs: deliveredAt + 1`. Subspec 00 requires cursor-based re-arm; ms-only advance is not equivalent under tuple ordering and can skip a same-`delivered_at` match still owed — a realistic case when the sweep records multiple incidents in one tick.

**2. Add a wait regression test for same-`delivered_at` mixed-project skip (required).** Seed two deliveries sharing `delivered_at` (different `incident_id`/`transition`), non-matching first and matching second; assert `--project` wait returns only the matching incident. Existing fixtures use distinct timestamps and would not catch the bug in (1).

**3. Fix operator-runbook contradiction on wait RPC count (required).** § Operator notifications still says wait “blocks on one daemon `notification_wait` call” while `--project` prose implies a client-side skip loop. Align prose: without `--project`, one blocking RPC; with `--project`, loop until a matching incident or RPC error.

**No other actuator changes required.** Empty `--project` matches checked acceptance criteria. Bare `--project`, stale `intent.md`, combined project+kind blocking-wake coverage, multi-RPC pinning, and case/unregistered-name tests are gaps or housekeeping outside required outcomes. Post-RPC list filtering is spec-intended.