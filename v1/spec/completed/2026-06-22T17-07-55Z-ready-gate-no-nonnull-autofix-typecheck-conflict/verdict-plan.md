## Verdict

The spec's direction is sound and faithful to the intent — a small, scoped config change to stop the ready gate's unsafe autofix from rewriting valid `!` non-null assertions into typecheck failures. The following refinements are required before finalization.

### Required refinements

1. **Resolve the "disable autofix vs. drop the rule" fork — commit to one direction (blocking).**
   The Decisions section already rules out dropping the diagnostic and commits to disabling the fix while keeping the lint signal. But the Task checklist and Acceptance criteria reintroduce "drop the rule to a non-`--write` level" as a live alternative, and AC #3 makes both the lint-behavior contract and the doc requirement *conditional* on that unmade choice. A spec must resolve a fork the intent left open; it cannot rule an option out in Decisions and then make acceptance hinge on it. Delete the discarded alternative from the checklist and ACs so the contract commits to a single direction (keep `noNonNullAssertion` as a diagnostic, disable only its fix).

2. **Strike the non-existent "non-`--write` level" mechanism (blocking, folds into #1).**
   There is no per-rule "write level" to drop a rule to — a Biome rule has a `level` and a separate `fix` setting; `--write`/`--unsafe` are CLI flags. The spec must describe the change in terms that map to a real config lever (disabling the rule's fix while keeping its diagnostic level). Removing the fork in #1 should eliminate this phrasing.

3. **Pin the rule's resulting diagnostic level.**
   AC #3 requires the `noNonNullAssertion` diagnostic to survive but never states at what level. The override must specify both that the fix is disabled and the level the diagnostic remains at, so the acceptance contract is unambiguous and the implementer isn't guessing.

4. **Soften the activation premise to match the evidence.**
   The spec attributes the rule's activation to the "recommended rule set," which is unverified (the rule's presence in that set wasn't confirmed). What *is* established is that the rewrite was actually observed during a real gate run. State the activation as empirically observed rather than asserting an unconfirmed cause.

5. **Make the regression decision explicit, and make ACs reproducibly verifiable.**
   Every acceptance criterion currently verifies against an ephemeral, hand-typed `match[1]!.trim()` file that is discarded — a one-shot manual demonstration, not a reproducible or durable check. Nothing guards against a future Biome upgrade silently re-enabling the unsafe fix, even though the repo already regression-tests gate invariants. The spec must either (a) add a durable guard (e.g., a config assertion that the `noNonNullAssertion` override exists with its fix disabled in `biome.json`), or (b) explicitly record why a manual check suffices and reword the affected ACs into a concrete, reproducible procedure. Resolving this silently is the defect; the spec must make a deliberate choice.

6. **Tighten the autofix-scope framing.**
   The checklist implies `check:fix` (safe) was part of the bug. The unsafe fix only ran under `check:fix:unsafe`; safe `check:fix` never applied it. Reword so it doesn't imply a behavior change to `check:fix`.

7. **Name the specific `v1-behaviors.md` entry to amend.**
   `check:fix:unsafe` appears in several entries of the parity baseline. The doc AC says only "the ready-gate parity entries" without naming which. Since this file is the v2 parity baseline, identify the specific entry (the gate pipeline / completion-gate entry) to update so the change lands in one correct place rather than ambiguously or duplicated.

### Rationale

Items 1–2 are mandatory: spec guidance requires a spec to resolve the choices the intent leaves open and to be internally consistent; an acceptance contract conditional on an unmade decision is unfinalizable, and a non-existent mechanism cannot be implemented as written. Items 3–4 are precision gaps that make the contract checkable. Item 5 enforces the principle that acceptance criteria be independently and reproducibly verifiable; the repo's own convention of regression-testing the gate makes leaving this silent a genuine gap. Items 6–7 are minor accuracy fixes that prevent the change from implying behavior it doesn't cause or landing in the wrong doc location.