## Verdict — Refinement Required

The spec's structure is sound (atomic, correctly scoped, right deliverable path: `prompts/patch/rules.md`). Six refinements are required before it's ready.

### Required refinements

1. **Reframe AC #2 — it currently demands a confirmation the agent cannot perform.** The agent reads inline guidance with no base ref, merge-base checkout, or rerun-at-base capability handed to it; base-ref machinery is harness-internal and explicitly out of scope per the intent. As written, AC #2 ("claiming pre-existing/baseline failures requires base-ref confirmation") tells the agent to do something undefined. Recast the principle as an actionable *prohibition with a why*: the agent should not raise a "pre-existing/unrelated/baseline failures" blocker, because the harness validates such claims against the base ref and an unconfirmed one will be rejected. Update the AC to check for that actionable sentence, not a git procedure.

2. **Reconcile with the existing `## Stop` "Repeated failure: record failure in spec; stop." line.** That line, as it stands, invites an agent to classify a mid-edit red rerun as "repeated failure" and stop — the exact failure mode this spec targets. Appending new guidance without qualifying that line risks a self-contradicting rules file. The spec must address this interaction (e.g., qualify the existing line to "repeated failure after edits are complete"), with a Decision and/or AC covering it.

3. **Account for the revision-bump convention.** `prompts/patch/rules.md` carries `revision:` frontmatter (currently 3); editing the body without bumping it breaks an observable convention. Add an explicit Decision or AC covering the bump.

4. **Address `v2/docs/v1-behaviors.md`.** This changes observable patch-agent behavior (when it raises a blocker), and repo convention requires any spec changing existing functionality to update that catalog or explicitly dismiss it. Silence is the silent-rot failure the convention guards against. A brief stated dismissal (e.g., catalog tracks harness/runtime behavior; this is prompt guidance with no runtime change) is acceptable, but it must be stated, not omitted.

5. **Make the section-placement choice explicit.** Principles 1–2 are blocker-grounds (belong in `## Stop`); principle 3 ("finish edits and re-run before concluding the suite is broken") is test-running discipline that `## Iteration` already partly owns. Splitting them across sections is a defensible alternative a competent implementer would weigh. The Decision must name the choice and the alternative it rules out rather than assert single-section placement as obvious.

6. **Pin the terse form.** The target file is clipped imperative bullets; the ACs are full sentences, risking verbose prose that clashes with the file and the repo's terseness mandate. Add a one-line Decision pinning the added text to terse bullets matching neighboring lines.

### Not upheld

- Presence-style ACs are the correct shape for a prompt-content deliverable — the file text *is* the contract, so no behavior beyond the words exists to assert. No change beyond rewording AC #2's content (per #1).
- The stale `CLAUDE.md` cross-reference (`v1/src/modes/patch/rules.md`) is a pre-existing repo issue outside this spec's scope. No action.