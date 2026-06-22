---
name: deterministic-model-tiering-policy
---

# Deterministic model-tiering: optimize cost vs failure-modes without losing determinism

> **Status (2026-06-22): staged into three pieces after design review.** The umbrella "one policy,
> not three knobs" goal stands, but the build is sequenced smallest-toil-first. This seed is now the
> **record of the staging + the difficulty-score follow-on**; the near-term piece lives in its own
> seed.

## The hard constraint (unchanged)

Determinism is a core Jarvis value. Cost-optimization may only use a **declared** complexity signal
(recorded once in spec/intent metadata, or a recorded failure signal), never a **per-run inferred**
hardness judgment.

## Staging

1. **Escalate-on-no-progress (near-term — build first).** A no-progress stop auto-advances the
   `agentOrder` ladder and retries instead of exiting. Reuses existing config, zero new schema,
   removes the manual model-bump toil. Owns the actuator-floor need (a too-weak actuator
   self-recovers by climbing). → [[escalate-actuator-on-no-progress]]. **Trigger is no-progress
   only** for now; other deterministic failures (nonzero exit, gate-fail) come later.

2. **Difficulty score (follow-on — this seed).** A declared `tier: trivial|standard|hard` stamped on
   the spec/intent at plan/intent time (operator-overridable) that sets the **starting rung** of the
   ladder, so a known-hard spec skips the wasted cheap attempt and a trivial one stays cheap.
   Deterministic because decided once and recorded, not re-inferred per run. Deferred behind #1
   deliberately: it's an *optimizer* (skip a ~22s wasted attempt), not a correctness fix — ship #1,
   learn whether the wasted attempts actually add up, then decide if this earns its surface (new spec
   field + stamping mechanism + tier→rung table + override plumbing).

3. **Per-sub-role model granularity (v2).** Each fixed sub-role within a phase (`patch`: actuator vs
   fix-up; `plan`: refine/draft → adversary → advocate → adjudicator → review-actuator) carrying its
   own agent:model. Fully deterministic by construction (fixed positions, zero inference) and the
   strongest long-term shape — but it **explodes the config**, and v2 will likely model it
   differently. Not a prerequisite for #1 or #2. Hypothesis worth A/B-ing when built: the
   adversary/critique pass is where deep reasoning pays (this session, every meaty bug was caught in
   review verdicts, not drafts), so *cheap draft + strong adversary* may beat *strong draft + cheap
   review*.

## Open questions for the difficulty-score follow-on (#2)

- Who stamps the tier — the intent/plan step (automatic from split size), the operator, or both
  (operator override of an intent default)? Can the step set it deterministically, or is that itself
  an inference? (Stamped-once-and-recorded keeps it deterministic regardless.)
- The tier→rung table: is it per-phase (a `trivial` plan vs a `trivial` actuate may map
  differently)?
- Does difficulty-score interact with #1's ladder as "sets the start, escalation climbs from there"?
  (Leaning yes — they compose cleanly.)

## Data points (this session)

- haiku actuator stalled in 22s (conversational reply, no edits) on the biome-config spec;
  manual sonnet bump → criteria-complete. Direct motivation for #1.
- sonnet plan on a trivial prompt-text intent: full-quality at ~half opus cost/time (~$1.67/7m vs
  opus ~$3.50/14m); repeated on a docs spec (sonnet 5m vs opus ~14m). Motivates declared cheap tiers.
- gpt-5.3-codex is the cheap-tier #2 after haiku — a capable actuator, reached via the **cursor**
  agent (OpenAI pulled subscription access). See [[gpt-5.3-codex-cheap-tier-via-cursor]].

## Out of scope

- Per-run *inferred* complexity scoring (non-deterministic — the thing this rejects).

## References

- [[escalate-actuator-on-no-progress]] — the near-term piece (#1).
- J / `v1/spec/completed/2026-06-20T06-29-05Z-review-shrink-model-tiering` — read-only-role tiering
  (shipped).
- `v1/docs/agents.md` — agent fallback order this reconciles with.
