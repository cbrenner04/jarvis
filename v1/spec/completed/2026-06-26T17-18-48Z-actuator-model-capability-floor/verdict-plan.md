## Verdict

The spec is sound in structure but has two genuine blockers that share one root cause, plus several cheap clarifications. Required refinements:

### Must fix (blockers)

1. **Reconcile the new numeric `capability` with the existing positional tier ladder.** The patch ladder's tier system (`trivial`/`standard`/`hard`) already encodes capability *by position* — it assumes cheapest/least-capable first and treats "last entry" as most capable. The spec introduces an operator-assigned `capability` integer whose decision 00 explicitly asserts "position is not capability." Both now drive the same `agentOrder`. The spec pins the filter/slice *mechanics* (floor filter precedes the tier start-index slice) but never states the *semantic* composition rule. The spec must add a decision that defines how floor `capability` and tier position coexist: state the monotonicity expectation (capability ordering aligns with ladder position) or explicitly that the tier selects position-within-eligible, not max-capability-within-eligible — and name what goes wrong if an operator's `capability` numbers are non-monotonic with position. This is the headline gap the intent specifically asked plan to resolve ("how floor-skipping composes with the existing quota-fallback ladder").

2. **Fix AC #1 in subspec 01 — it is falsifiable for non-trivial tiers.** Because filtering precedes the tier slice, initial selection does *not* "start on the first floor-eligible agent" except at the `trivial` tier; `standard`/`hard` start later in the eligible ladder. Restate the criterion (and the corresponding decision-01 selection rule) as "the first floor-eligible agent at or after the tier start index." Same root cause as #1.

### Must clarify (cheap, leaving them implicit is a gap)

3. **State how explicit `--agents` overrides interact with the floor.** Overrides substitute a model onto an entry *after* it passes the capability filter, so an override can place a below-floor model on an above-floor entry. Add one decision resolving this either way: floor governs configured entries and explicit `--agents` is a deliberate operator escape hatch, or the floor re-checks the effective model. Silence on a documented bypass is the gap; a single line resolves it.

4. **Name all drain outcomes, not just quota.** Floor filtering shrinks the ladder, so the no-progress drain (exit 4) is reached sooner alongside the quota drain (exit 2). Decision 01 / AC #4 mention only exit 2. Generalize the wording so existing drain outcomes (exit 2 quota, exit 4 no-progress) are preserved and distinct from the floor error — the underlying principle (qualifying-agents-exhausted is a runtime outcome, not a config error) already covers both.

5. **Align "integer" with the validation.** Decision 00 calls `capability` an integer but validation accepts any finite number. Rank only needs ordering; reconcile the prose and the rule (loosen the prose to "number," or validate integer) so they don't contradict.

6. **Name the shrink error channel (subspec 02).** 02 says "emit the named floor error" without specifying the channel; patch iteration uses a defined stderr + telemetry contract. State that shrink's floor error matches that same contract.

7. **Resolve the conditional doc update.** Subspec 01's "note the floor skip in run-loop.md *if selection is documented there*" is un-checkable as written. run-loop.md does document iteration/fallback — make the update unconditional.

### Defensible as-is (no refinement required)

- **Exit 1 reuse for the empty-eligible error.** The contract is the named error message (role + floor), which is the correct discriminator and already specified. A dedicated exit code would be scope creep without precedent.
- **Subspec 00 not updating `v1-behaviors.md`.** 00 is net-new, feature-off-by-default config surface; no existing v1 behavior changes when the floor is unset, and the behavioral catalog entries land naturally in 01/02. Optional, not required.

Rationale: refinements 1–2 are required because acceptance criteria must be verifiable and the intent explicitly tasked plan with reconciling floor-skipping against the fallback ladder; an unstated semantic conflict between two capability models is exactly the load-bearing decision a spec must pin. Refinements 3–7 close documented-behavior gaps where the spec is silent or self-contradictory — each a one-line fix, but each a place an implementer would otherwise guess.