- Define qualitative one-iteration sizing: one implementation path, focused verification, and no independently implementable builder, wiring, or validation path bundled. Keep coupled changes together; do not invent numeric thresholds.

- Make review explicitly detect oversized subspecs and require an adjudicated split outcome, rather than relying on ambiguous general review wording.

- Require splits to preserve scope: every original task and acceptance outcome appears exactly once across replacements, with no orphaned work; the index links all replacements and remains routable.

- Require an end-to-end actuator guard showing an oversized verdict produces a valid split tree. Prompt snapshots alone do not prove the review outcome is applied.

- Clarify documentation authority: `v1/docs/plan-mode.md` states the operator behavior; `v2/docs/v1-behaviors.md` records the sourced parity entry without duplicating normative guidance.
