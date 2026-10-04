# Verdict: Refinement Required

The audit's structure, citations, scope discipline, and core conclusion (most columns are already-logged/derivable) are sound and must be preserved. But several table cells and derivation snippets contain errors that would propagate wrong answers into the downstream schema work this audit exists to anchor. The following must be fixed.

## Required outcomes

1. **`aggregate_files_touched` must not be classified not-captured (critical).** The doc classifies session-level `files_touched` as *derivable from git diff*, then classifies overlord-level `aggregate_files_touched` as *not-captured* — and justifies it with the "patch-only telemetry gap." This is internally contradictory: the files derivation sources from git history, not JSONL, so the plan-phase telemetry emission gap is irrelevant to it. The cell's own notes already state a working derivation ("diff against main branch at session start"). Per the spec's load-bearing bias rule (a column may not be classified not-captured when a derivation from a documented source exists, here git history admitted by Decision 2), this column must be reclassified to derivable (with caveat), and its justification must stop invoking the telemetry gap for a git-sourced field. A wrong not-captured here would steer downstream schema work to add harness logging this audit exists to rule out.

2. **`files_touched` primary derivation must use the run base, not `HEAD~1`.** A Jarvis run commits per iteration, so a `HEAD~1` diff captures only the final commit's files and undercounts multi-commit runs. The correct run-base diff is present but demoted to secondary. Promote the run-base/spec-base diff to the primary derivation so the downstream work inherits the correct command.

3. **`duration_minutes` time units must be internally consistent.** The inventory describes `ts` as a Unix timestamp (conventionally seconds), but the JSONL fallback divides by 1000 (treating it as milliseconds). Pin the actual unit of `ts` and make the derivation consistent with it. State the units of `plan_time`/`run_time` as well, since this is a precision doc whose value is correct derivations.

4. **Overlord `session_type` must not be labeled already-logged-from-CSV.** There is no `session_type` column in `overlord-costs.csv`. Per the spec's own Decisions this value is a pinned constant (`orchestration`), not a recorded field. Reclassify/relabel it as a pinned constant rather than attributing it to CSV context.

5. **Tighten two overstated source attributions** so every named source field traces to a real recorded value (AC: derivable rows must name traceable source fields):
   - `overall_success`: it derives from per-session `success_status` *hints*, not a recorded JSONL field. Correct the "from JSONL" attribution to reflect that it aggregates derived per-session hints.
   - `report_date`: the `report`-field fallback is unverified against the cited docs. Drop or explicitly qualify it as unverified; the `run_start_ts` primary is solid and sufficient.

## Rationale

Findings 1–4 are correctness defects, not style: each would carry a wrong fact into the schema/backfill work that cites this audit as its load-bearing decision. Finding 1 directly violates the spec's bias-toward-captured rule. Finding 5 closes traceability gaps the spec's derivable-row criterion requires. No reclassification beyond these is warranted — the compound `success_status`/`failure_reason` classifications, the `agent_count` filter, and the overall bias of the audit are correct as written. (Optional, non-blocking: a one-line note that the `success_status` exit-derived hint is lossy on partial-progress stops — already mitigated by the observer override.)