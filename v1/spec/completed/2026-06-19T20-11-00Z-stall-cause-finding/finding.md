# Stall Cause Finding: Pre-Instrumentation Corpus

## Search scope

Exhaustive search of `~/.jarvis/runs.jsonl` (1044 rows, 2026-05-15T03:41:55.934Z–2026-06-19T20:21:25.246Z) for `mode: "patch"`, `exit_reason: watchdog-iteration-timeout`, and `duration_ms` ≥ 1 740 000 (30 m default minus 1 m margin).

**Result:** 0 post-instrumentation candidates (rows with `last_output_age_ms`). Stall-diagnostics merged 2026-06-19 in commit a10fb53 (PR #280); production runs.jsonl has not yet recorded a watchdog iteration timeout under that instrumented build.

## Cited iterations (pre-instrumentation fallback)

All five rows lack `last_output_age_ms`, `watchdog_descendants_alive`, and stall-diagnostics output — pre-instrumentation rows (before stall-diagnostics deployed). Correlation by `namespace`, `ts`, and `iteration`. Available fields: `watchdog_pgid` (process group); unavailable diagnostic fields per pre-instrumentation contract. Session logs searched; no [watchdog] diagnostics lines recorded at these timestamps.

### Case 1: daemon-host-ipc, iteration 3

| Field | Value |
| --- | --- |
| namespace | `jarvis:2026-06-14T17-21-04Z-daemon-host-ipc-logging` |
| ts | `2026-06-14T20:33:43.945Z` |
| iteration | 3 |
| duration_ms | 1 800 719 |
| agent | cursor |
| watchdog_pgid (available) | 98785 |

**Classification:** `other` — pgid-unavailable path (pre-instrumentation); session logs searched but [watchdog] output not preserved in accessible window.

### Case 2: plan-intent-refine-flow, iteration 4

| Field | Value |
| --- | --- |
| namespace | `jarvis:2026-06-14T17-55-24Z-plan-intent-refine-flow` |
| ts | `2026-06-14T20:52:32.175Z` |
| iteration | 4 |
| duration_ms | 1 800 150 |
| agent | cursor |
| watchdog_pgid (available) | 4883 |

**Classification:** `other` — pgid-unavailable path (pre-instrumentation); session logs do not contain [watchdog] diagnostic line.

### Case 3: daemon-host-ipc, iteration 4

| Field | Value |
| --- | --- |
| namespace | `jarvis:2026-06-14T17-21-04Z-daemon-host-ipc-logging` |
| ts | `2026-06-14T21:56:22.012Z` |
| iteration | 4 |
| duration_ms | 1 800 074 |
| agent | cursor |
| watchdog_pgid (available) | 22536 |

**Classification:** `other` — pgid-unavailable path (pre-instrumentation); available field values match telemetry row.

### Case 4: classify-claude-zero-exit-quota-result, iteration 3

| Field | Value |
| --- | --- |
| namespace | `jarvis:2026-06-19T16-26-24Z-classify-claude-zero-exit-quota-result` |
| ts | `2026-06-19T17:26:38.755Z` |
| iteration | 3 |
| duration_ms | 1 800 061 |
| agent | cursor |
| watchdog_pgid (available) | 37669 |

**Classification:** `other` — pgid-unavailable path (pre-instrumentation).

### Case 5: stall-diagnostics-instrumentation, iteration 3

| Field | Value |
| --- | --- |
| namespace | `jarvis:2026-06-19T17-53-54Z-stall-diagnostics-instrumentation` |
| ts | `2026-06-19T18:36:25.904Z` |
| iteration | 3 |
| duration_ms | 1 800 073 |
| agent | cursor |
| watchdog_pgid (available) | 24338 |

**Classification:** `other` — pgid-unavailable path (pre-instrumentation).

## Dominant cause

**`inconclusive`** — all cited cases are pre-instrumentation and classified `other`. No post-instrumentation rows with `last_output_age_ms` or `watchdog_descendants_alive` are available to distinguish hung-subprocess from agent-idle.

## Corpus bias note

Exclusion of `iteration-timeout` rows: 1 row matched the duration filter but exit via non-watchdog timeout (`jarvis:2026-05-19T21-52-14Z-run-test-hang-and-watchdog-fix`, iteration 3, 2026-05-20T02:45:18.233Z). Dominant cause remains inconclusive; non-watchdog timeouts are outside this corpus scope per spec decision.

## Idle-bound verdict

**`not-warranted`** — inconclusive dominant cause and absent instrumentation preclude output-idle bound sketch. No `last_output_age_ms` values are available. Idle-output watchdog design should proceed gated on post-instrumentation corpus; reassess once stall-diagnostics timeouts occur in production.

---

**Note:** This finding is constrained by pre-instrumentation telemetry. Post-instrumentation rows (available after stall-diagnostics merge propagates to production) will support definitive classification and idle-bound judgment. No harness changes are recommended until instrumented evidence emerges.
