# Verdict: Refinement Required

The spec's structure, scope discipline ("recorded classification, no runtime change"), and citation framing are sound and should be preserved. But the review surfaced a real, serious cluster of defects centered on one root problem: **the acceptance criteria grade the audit's *shape*, not its *correctness or bias* — so a confidently-formatted but wrong audit passes every check.** Since the intent designates this audit as the load-bearing decision for downstream schema/backfill work, a wrong-but-well-formatted result is the worst failure mode. The following refinements are required.

## Upheld — must address before landing

1. **No criterion enforces the audit's core bias (critical).** The intent's load-bearing instruction is "bias toward already-logged/derivable over not-captured." Nothing in the Decisions or ACs encodes this, so an audit that dumps every column into `not-captured` passes. The spec must add at least one AC that bites on misclassification — e.g., no column may be classified `not-captured` when a derivation from a documented telemetry field or cost-CSV header exists. Add a companion AC that every named source field is traceable to its cited doc (grades citation accuracy, the audit's actual value).

2. **"Exactly one bucket" contradicts the schema intent this audit feeds (critical).** The downstream schema treats `success_status` as *hybrid* — both an exit-derived hint (from `exitReason`/quota signals) and an observer judgment with override. The current "every column gets exactly one bucket" rule plus the task item pre-committing `success_status` to observer-only forces a dichotomy that contradicts its own consumer. Relax the rule to admit a compound classification (derived-hint + observer-override) for genuinely hybrid status fields.

3. **Baked-in example classifications contradict the docs (critical).** The spec hard-codes two derivations the audit is supposed to *determine*:
   - `duration_minutes` is prescribed as "derivable from `runs.jsonl`," but `session-costs.csv` already carries `plan_time`/`run_time` and `overlord-costs.csv` carries `api_time` — leaning already-logged.
   - `files_touched` is sourced "from the run diff," but Decision 2 declares the source of truth to be documented telemetry schema + cost-CSV headers — which excludes the run diff. Either reframe `files_touched` or widen Decision 2 to admit the run diff explicitly (and address whether the diff is reliably persisted post-run).
   
   Reframe both as candidate derivations to verify, not asserted classifications. The audit must re-derive these rather than inherit pre-decided answers from the seed.

## Upheld — valid refinements

4. **Overlord columns are never enumerated.** The session sheet has a concrete identifier list; the overlord side is only prose ("specs driven, overall success, …"), making AC #2's "classify every overlord roll-up column" unfalsifiable. Pin the overlord column set to identifiers, and note that `overlord-costs.csv` already carries `session_count` (specs driven), `api_time` (total duration), `total_cost`, `avg_cost_per_spec` — most roll-ups are already-logged, which strengthens the spec's own bias thesis.

5. **Patch-vs-plan telemetry gap.** The spec's own inputs note telemetry JSONL is patch-mode only ("plan phases emit limited rows"), yet overlord/orchestration sessions are the plan side. Any overlord roll-up claimed derivable-from-telemetry must account for this emission gap. "Aggregate files touched" for overlord has no obvious CSV home and hits exactly this gap — flag it explicitly.

6. **Join/key columns lack a home.** `session_id` and `report_date` are bookkeeping/join keys, not outcomes, and "exactly one bucket" gives them no escape hatch. Define their handling (exclude with rationale, or classify `session_id` as the cost-CSV join key / `report_date` as derivable from `ts`).

7. **`agent_count` derivation is under-pinned.** A naive row count of `runs.jsonl` would be wrong: `record_role: "run_terminal"` rows are deliberate duplicates summaries must exclude, and synthetic `agent: harness` bookkeeping rows exist. The derivation must state the filter (distinct real agents in the fallback chain, excluding `run_terminal`/`harness`). This is exactly the precision the audit exists to produce.

## Minor

8. Add a one-line note that `~/.jarvis/runs.jsonl` *is* the telemetry JSONL (the inputs section currently reads as two separate files).

## Rationale

Refinements 1–3 are necessary because spec guidance requires acceptance criteria to verify the actual contract, not incidental form — and here the contract is a *correct, bias-toward-already-captured* classification feeding downstream work. Refinements 4–7 close unfalsifiable or under-specified criteria that would let "done" be declared on an incomplete or subtly-wrong audit. None over-reach; all tighten the spec toward producing the precise classification its consumer depends on.