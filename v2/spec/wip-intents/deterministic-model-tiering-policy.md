# Deterministic model-tiering: optimize cost vs failure-modes without losing determinism

> **Status: evolving seed (open questions below).** Accruing data points during the overlord
> batch; settle the open questions, then run through intent → plan. Modify freely until then.

## Problem

Jarvis has multiple model-selection knobs that today are ad-hoc:
- J / review-shrink-model-tiering (shipped): cheap models fine for **read-only** review roles.
- [[actuator-role-model-floor]] (seed 7): a **floor** so the actuator isn't run on too-weak a model.
- Observed live this session: a **sonnet-authored spec** for a trivial prompt-text intent was
  full-quality at ~half the opus cost/time; and the **haiku actuator** needed sonnet-class
  intervention on the meatier specs.

These are the same dial — cost vs failure-resistance — turned independently per phase. We want one
**policy**, not three knobs. The hard constraint: it must stay **deterministic** (a core Jarvis
value). "Use the cheap model unless the task is hard" is *not* deterministic if the harness has to
**infer** hardness each run.

## Crux

Determinism and cost-optimization only coexist when the complexity signal is **declared, not
inferred**. A recorded decision (in spec/intent metadata, or a recorded failure signal) is
deterministic; a per-run hardness judgment is not.

## Candidate shapes

1. **Declared tier.** Spec/intent carries `tier: trivial|standard|hard` (or a model id); harness
   maps tier→model with a fixed table. The **intent step already sizes work** — it could stamp the
   tier as it splits (a single-behavior trivial intent → `tier: trivial`), so tiering rides the
   sizing that already happens. Deterministic: decided once, recorded.
2. **Escalate-on-failure ladder.** Start cheap; a deterministic failure signal (nonzero exit,
   no-progress stop, lint-fail at gate) promotes the next attempt to a stronger model. Deterministic
   trigger; bounded waste. This is the "haiku → sonnet on failure" pattern as a rule;
   [[actuator-role-model-floor]] is the floor that stops the ladder starting too cheap.
3. **Static per-phase floors.** review cheap / actuate floored / plan strong. Fully deterministic
   but coarse — can't tell a trivial plan from a chokepoint-refactor plan.

**Leaning synthesis:** declared tier sets the floor (stamped by the intent step), escalate-on-failure
handles the rest. Deterministic at both ends; unifies J + seed 7 + the two experiments into one
policy.

## Open questions

- Who stamps the tier — the intent step (automatic, from split size), the operator, or both (operator
  override of an intent default)? Can the intent step set a tier deterministically, or is that itself
  an inference?
- What is the tier→model table, and is it per-phase (a `trivial` plan vs a `trivial` actuate may map
  differently)?
- Does escalate-on-failure re-run wasted-cheap-attempt cost beat just starting at the floor? When is
  the ladder worth it vs a static floor?
- Does this **supersede** seed 7 and the J guidance (fold them in), or sit above them as the umbrella
  policy?
- How does this interact with the existing agent **fallback order** (quota fallback advances agents;
  tiering changes models within an agent)? Are tier and fallback-order one ordered list or two axes?
- Granularity: per-phase only, or per-subspec? (A spec can mix a trivial subspec and a hard one.)
- **Per-sub-role-within-a-phase (strongest determinism candidate).** Sub-roles inside `plan`
  (refine/draft → adversary → advocate → adjudicator → review-actuator) are *fixed positions*, so a
  role→model table needs **zero inference** — fully deterministic by construction, no declared tier
  required. Open: which model for which sub-role? Hypothesis (to A/B): the **adversary/critique pass
  is where deep reasoning pays** (this session, every meaty bug — detached-worktree, regression-
  masking, counter-ordering — was caught in review verdicts, not drafts), so *cheaper draft + opus
  adversary* may beat *opus draft + cheap review*. Caveat: a weak draft floors the adversary (can't
  critique a vague spec). Config note: per-phase `agentOrder`s already exist (`plan`/`review`/`patch`/
  `prompt`); per-*pass-within-plan* would need new config granularity.

## Data points (accruing this session)

- sonnet plan on a trivial prompt-text intent: full-quality, ~$1.67/7m vs opus ~$3.50/14m.
- haiku actuator: correct code but needed iterations/hand-finalize on chokepoint refactors; fine on
  trivial edits.
- (more to come as the batch runs)

## Out of scope

- Per-run *inferred* complexity scoring (non-deterministic — the thing this seed rejects).

## References

- [[actuator-role-model-floor]] — the floor half of the ladder.
- J / `2026-06-20T06-29-05Z-review-shrink-model-tiering` — read-only-role tiering (shipped).
- `v1/docs/agents.md` — agent fallback order this must reconcile with.
