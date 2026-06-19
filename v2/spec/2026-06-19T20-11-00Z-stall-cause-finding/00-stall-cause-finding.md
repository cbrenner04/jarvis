# Stall cause finding

Investigate real stalled patch iterations and commit a written finding that
names the dominant stall cause with per-iteration evidence so a remediation
decision (e.g. idle-output watchdog) is grounded, not guessed.

## Problem

Iterations repeatedly burn the full `iterationTimeoutMs` before the watchdog
aborts them. The dominant cause is unconfirmed: agent waiting on a hung
subprocess it spawned vs. the agent genuinely idle with no output. Remediation
scope cannot be chosen without evidence from stall-diagnostics on real
`watchdog-iteration-timeout` rows.

## Prerequisites

- Merged stall-diagnostics instrumentation: `last_output_age_ms` and
  `watchdog_descendants_alive` on `watchdog-iteration-timeout` rows (pgid-unavailable
  rows omit descendants fields per stall-diagnostics contract).

## Decisions

- Deliverable is `finding.md` in this spec directory; no harness code or durable
  doc change. Rules out folding investigation into a remediation PR that presumes
  the cause.
- Evidence from operator `~/.jarvis/runs.jsonl` and matching session logs only.
  Rules out synthetic test fixtures or new telemetry fields.
- Corpus: `mode: "patch"` and `exitReason: watchdog-iteration-timeout` only —
  exclude `iteration-timeout` (no diagnostics by design). Finding notes possible
  bias when non-watchdog timeouts may matter. Rules out mixing prompt/plan rows or
  undiagnosable timeout reasons.
- Candidate filter: row `duration_ms` ≥ configured `iterationTimeoutMs` minus a
  fixed margin (≥29m when default 30m applies). Rules out quota-early and
  ambiguous near-miss rows.
- Post-instrumentation rows only, after exhaustive search of `~/.jarvis/runs.jsonl`.
  ≥3 distinct cited iterations is the target; if fewer qualify, append `## Blocker`
  to this subspec with qualifying count and searched date range — do not fabricate
  cases or lower the bar.
- Correlation keys: `namespace` + row `ts` + `iteration`. Rules out nonexistent
  `run_id` / free-form iteration-index labels.
- Per-case evidence cites **available** stall-diagnostics fields: when pgid known,
  include `watchdog_descendants_alive`, optional `watchdog_pgid`, and `[watchdog]`
  suffix when emitted; when pgid unavailable, cite `last_output_age_ms`, note
  pgid-unavailable, and use iteration banner / harness stderr — no `[watchdog]`
  line required. Rules out mandating omitted instrumentation.
- Session-log traceability: log file for `namespace` whose time window contains
  row `ts`; iteration section = lines between that iteration's start marker and
  the next iteration or run end.
- Per-case classification rubric:
  - `hung-subprocess`: pgid known, `watchdog_descendants_alive: true` at snapshot.
  - `agent-idle`: pgid known, `watchdog_descendants_alive: false`, and
    `last_output_age_ms` null or skewed toward full timeout — operational "no
    output + no in-group descendants," not model thinking.
  - `other`: pgid unavailable; orphan-escape pattern (`setsid` escapees →
    false-negative liveness per `run-loop.md`); or inconclusive logs.
- Log-context check for escaped descendants; do not classify those as
  `agent-idle` without noting minority/`other`. Rules out trusting
  `watchdog_descendants_alive: false` alone when logs show escapees.
- Dominant cause: single category when majority; otherwise `mixed` with per-category
  counts and minority patterns named. Rules out an unranked hypothesis list.
- Idle-bound verdict (`warranted` / `not-warranted`) coupled to dominant cause:
  sketch an output-idle bound only when dominant (or majority idle component of
  `mixed`) is `agent-idle`; dominant `hung-subprocess` → `not-warranted` for
  idle-output bound unless finding gives explicit alternate remediation rationale;
  `mixed` verdict must address idle component explicitly. Rules out idle-bound
  sketches disconnected from dominant cause.
- "Sketch a bound" = output-idle span under `iterationTimeoutMs`, reset on
  stdout/stderr — aligned with `idle-output-watchdog` intent, not wall-clock
  shrink; not a committed config default.
- Deferred to first consumer: exact idle-bound default and config key — pin when
  idle-output-watchdog intent implements the knob.

## Task checklist

- [ ] Search `~/.jarvis/runs.jsonl` exhaustively for post-instrumentation
  candidates: `mode: "patch"`, `exitReason: watchdog-iteration-timeout`,
  `duration_ms` ≥ timeout minus margin (≥29m at default 30m).
- [ ] If <3 qualify, append `## Blocker` with count and searched date range; stop.
- [ ] For each cited iteration, extract `namespace`, `ts`, `iteration`, available
  diagnostic fields (`last_output_age_ms`; `watchdog_descendants_alive` and
  `watchdog_pgid` when pgid known), and traceable session-log excerpt per
  traceability rules above.
- [ ] Classify each cited case per rubric; check logs for `setsid` escapees.
- [ ] Determine dominant cause (single category or `mixed` with counts); note
  minority patterns and corpus bias from excluded `iteration-timeout` rows.
- [ ] Record idle-bound verdict per coupling rules; if warranted, sketch
  output-idle bound from cited `last_output_age_ms` values and
  `iterationTimeoutMs`.
- [ ] Write `finding.md`.

## Acceptance criteria

- [ ] Each cited iteration is identifiable in `~/.jarvis/runs.jsonl` by
  `namespace` + `ts` + `iteration`; `finding.md` field values match those rows.
- [ ] Each cited iteration includes available stall-diagnostics fields per pgid
  path above and a session-log excerpt traceable to that iteration's log section.
- [x] `finding.md` cites ≥3 distinct qualifying iterations, or this subspec carries
  `## Blocker` documenting exhaustive search with <3 qualifying rows.
- [ ] Each cited iteration has a per-case classification (`hung-subprocess`,
  `agent-idle`, or `other`) per rubric and log context, including escapee handling.
- [ ] Finding names dominant stall cause (single category or `mixed` with counts)
  and notes minority patterns and `iteration-timeout` exclusion bias when relevant.
- [ ] Finding records idle-bound verdict (`warranted` / `not-warranted`) per
  coupling rules; if warranted, sketches an output-idle bound using cited
  `last_output_age_ms` values and `iterationTimeoutMs`.
- [x] This PR changes only files under this spec directory (no edits under
  `v1/src/`, `shared/`, `v1/docs/`, or `v2/docs/`).

## Documentation updates

- [ ] `finding.md` in this spec tree (work intent / evidence per
  `v2/docs/documentation-standard.md`).
- No durable `v1/docs` or `v2/docs` change in this slice.

## Out of scope

- Implementing any abort bound or watchdog change.
- Changing telemetry shape.
- Synthetic reproduction via patch-mode test fixtures (consumes production
  telemetry only).

## Blocker

Exhaustive search of `~/.jarvis/runs.jsonl` (1044 rows,
`2026-05-15T03:41:55.934Z`–`2026-06-19T20:21:25.246Z`) found **0**
post-instrumentation qualifying iterations.

Filter applied: `mode: "patch"`, `exit_reason: watchdog-iteration-timeout`,
`duration_ms` ≥ 1 740 000 (30 m default minus 1 m margin), row includes
`last_output_age_ms` (stall-diagnostics contract).

Near-miss pre-instrumentation rows (5 total, all lack `last_output_age_ms`):

| namespace | ts | iteration | duration_ms | watchdog_pgid |
| --- | --- | --- | --- | --- |
| `jarvis:2026-06-14T17-21-04Z-daemon-host-ipc-logging` | `2026-06-14T20:33:43.945Z` | 3 | 1800719 | 98785 |
| `jarvis:2026-06-14T17-55-24Z-plan-intent-refine-flow` | `2026-06-14T20:52:32.175Z` | 4 | 1800150 | 4883 |
| `jarvis:2026-06-14T17-21-04Z-daemon-host-ipc-logging` | `2026-06-14T21:56:22.012Z` | 4 | 1800074 | 22536 |
| `jarvis:2026-06-19T16-26-24Z-classify-claude-zero-exit-quota-result` | `2026-06-19T17:26:38.755Z` | 3 | 1800061 | 37669 |
| `jarvis:2026-06-19T17-53-54Z-stall-diagnostics-instrumentation` | `2026-06-19T18:36:25.904Z` | 3 | 1800073 | 24338 |

No row in the corpus carries `last_output_age_ms` or
`watchdog_descendants_alive`. Stall diagnostics merged in `a10fb53` (PR #280);
production `runs.jsonl` has not yet recorded a watchdog timeout under that build.
Session logs for the five rows show pre-instrumentation `[watchdog]` lines (no
diagnostic suffix).

Corpus bias note: 1 excluded `iteration-timeout` patch row
(`jarvis:2026-05-19T21-52-14Z-run-test-hang-and-watchdog-fix`, iteration 3,
`2026-05-20T02:45:18.233Z`).

**Unblock:** re-run after ≥3 patch watchdog timeouts occur on a jarvis binary
with stall diagnostics deployed; then resume this subspec.
