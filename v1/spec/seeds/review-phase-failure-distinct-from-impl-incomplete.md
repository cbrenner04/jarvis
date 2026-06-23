---
name: review-phase-failure-distinct-from-impl-incomplete
---

# `jarvis run` post-completion review failure should not read as a generic error

## Problem

When the implementation completes (all acceptance criteria ticked, completion gate green) but the
**post-completion review phase** then fails — e.g. the review agent exhausts quota and its fallbacks
also fail — `jarvis1 run` exits `1` with a generic error. Observed this session on the
model-tiering spec: codex hit quota across every review role (adversary/advocate/adjudicator/actuator)
and cursor fell over, so the run exited `1` even though the code was done, the gate had passed, and
every AC was ticked. The PR was simply left in draft (review never auto-readied it).

The generic `exit 1` obscures the real state: **the implementation succeeded; only the optional
review/auto-ready step failed.** An operator reading `exit 1` can't tell "code is broken" from
"code is fine, review couldn't run" without digging through the log. Recovery here was a manual
finalize (review the diff by hand, run the gate, `gh pr ready` + admin-merge) — exactly the kind of
hand step the north star wants eliminated.

## Direction

Distinguish a **review-only** failure from an implementation failure. Options for plan to weigh:

- A distinct exit code / `exitReason` (e.g. `review-incomplete`) when the spec reached
  criteria-complete + gate-green and only the post-completion review/auto-ready failed.
- Leave the implementation commits + PR intact and emit a clear operator message: "implementation
  complete and gated; review did not finish (reason) — finalize or re-run review with
  `--resume-review`."
- Consider auto-readying the PR on a gate-green tree even when review couldn't run (review is a
  quality pass, not a merge gate), so the operator isn't blocked on a draft.

Determinism/safety unchanged; this is about *reporting* a partial outcome, not changing what runs.

## Out of scope

- Making the review phase itself more quota-resilient (separate concern; quota fallback already
  rotates agents).

## References

- `v1/src/modes/patch/run.ts` — post-completion review phase + exit classification.
- `jarvis1 run --resume-review` — existing path to re-run review on an already-complete spec.
- Observed 2026-06-23 on `declared-tier-starts-model-escalation` (report
  `reports/2026-06-23T09-10-00Z-overlord.md`).
