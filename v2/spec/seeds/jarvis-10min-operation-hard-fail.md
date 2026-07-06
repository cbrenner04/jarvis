---
name: jarvis-10min-operation-hard-fail
---

# Any jarvis operation over 10 minutes should hard-fail fast

Operator policy: a single jarvis-driven operation that runs longer than **10 minutes** is a miss
— it almost always means a wedge/stall, not legitimate work — and should hard-fail promptly with a
clear, named reason instead of dragging to a distant watchdog or CI ceiling. Observed this session:
a review actuator that ran to the 30-min `iterationTimeoutMs` watchdog, and a CI full-suite step
that hung ~96 minutes before manual cancellation.

## Decisions

- Adopt a **10-minute hard-fail budget** as the default upper bound for individual jarvis
  operations, replacing today's looser limits where they exceed it. Concretely:
  - `iterationTimeoutMs` default drops from `1_800_000` (30 min) toward `600_000` (10 min).
  - Per-file test timeouts (`PER_FILE_TIMEOUT_MS`, agent/integration modes in
    `scripts/run-v2-tests.ts` and `scripts/run-tests.ts`) stay well under 10 min (already 60s).
  - Completion/ready and review-actuator phases fail fast at the budget with a named exit reason
    (which phase, which spec/file) rather than a bare timeout.
- The failure message must **name what exceeded the budget** so the next operator sees the culprit
  immediately (mirrors the per-file "on file X" naming just added to the test runners).
- Keep the budget **configurable** (operator can raise it for a genuinely long legitimate step),
  but the default is 10 minutes and the intent is that hitting it is treated as a defect to fix,
  not a knob to loosen.

## Out of scope

- CI job-level (`ci.yml`) timeout tuning beyond what the test-runner per-file timeouts already
  bound (separate if needed).
- Reworking the watchdog's idle-detection mechanism itself; this is about the time budget it
  enforces.

## Documentation updates

- `v1/docs/operator-runbook.md`: record the 10-min hard-fail budget and that a >10-min jarvis
  operation is treated as a wedge/defect, not tolerated.
- Any config docs listing `iterationTimeoutMs` defaults.
