# Adjudicator verdict: plan debate review premise-falsification pass

## Required refinements

1. **Align intent with the advisory contract.** `intent.md` still says the pass is "required," that the reviewer "must establish" reachability, and that unreachable premises are "rewritten or dropped before the spec lands." The subspec correctly models advisory `REVIEW_PASS_CONTEXT` surfacing (same class as hollow-pin), with debate operators acting on findings — not a harness gate or automatic rewrite. Reconcile intent wording with the subspec so the merged spec does not promise machine enforcement the implementation will not ship.

2. **Add `bun run test:v1` to the final verification AC.** Tasks change `prompts/plan/review-adversary.md` and `v1/test/fixtures/prompts/rendered/`. Requiring only `test:shared` and `test:v2` allows broken v1 snapshot fixtures while ACs pass. Match hollow-pin's verification bar.

3. **Acceptance criteria for non-destructive hollow-pin composition.** The intent and decisions require premise findings under `## Unfalsifiable premises` ahead of `## At-risk hollow pins`, with empty sections omitted. No current AC exercises a fixture where both passes fire. Add coverage that both sections appear in correct order and neither clobbers the other — this is the second-lander's core obligation and a keystone prerequisite.

4. **Acceptance criteria for empty-subspec reporting.** The decision that a flagged premise leaving zero remaining non-human-only criteria must report the subspec would be empty (not invent filler) has no AC. Add coverage — a keystone prerequisite depends on it.

5. **Acceptance criteria for scan-scope parity.** The spec claims hollow-pin parity (acceptance-criteria blocks in staged `.md` files only; skip human-only; exclude `index.md`, `intent.md`, nested paths). Hollow-pin AC'd these boundaries; this spec should too, or the parity claim is untested.

6. **Acceptance criteria for documentation updates.** Three doc files are tasked (`v1/docs/spec-guidance.md`, `v2/docs/operator-runbook.md` § Gate trust, `v2/docs/v1-behaviors.md`) but none are AC'd. Add criteria that the required guidance lands in each surface (reachability citation for rule-out criteria; finalized premise-smell bullet with seed placeholder removed; `## Unfalsifiable premises` injection documented with composition order).

7. **Pin the fan-out replay fixture.** The retired fan-out criterion AC paraphrases historical text; the spec tree is gone. Embed the verbatim criterion in the test fixture (from git history) so the replay AC is reproducible without operator memory.

8. **Acceptance criteria for selection-shape false positives.** Selection includes broad patterns like `must not`. The reachable-violation AC proves cited guards pass, but not that ordinary behavioral `must not` outcomes (without invariant/rule-out framing) are left alone. Add a negative case so the heuristic does not over-flag legitimate behavioral criteria.

9. **Acceptance criteria for debate-role rendering.** Mirror hollow-pin: assert adversary and advocate rendered prompts receive injected premise findings; assert adversary-specific instruction to surface unfalsifiable-premise findings. `REVIEW_PASS_CONTEXT` flowing to adjudicator via shared rendering does not need a separate role AC if the composition AC covers context building.

10. **Clarify decision bullets that implementers will otherwise guess:**
    - Premise selection walks all non-human-only acceptance-criterion blocks via shared block parsing — it does not filter through `selectMutationCheckpointCriteria`.
    - Reachability is citation-heuristic advisory (staged markdown tokens/prose), not base-repo inspection; cite-present ≠ actually reachable, no-citation ≠ actually dead — same precision class as hollow-pin.
    - Define or exemplify "explicit violation hook" for production-path citations (positive and negative).
    - Make reachability prose phrases an explicit match set (e.g. `reachable on`, `fails against the pre-fix`, `constructible on main`) rather than open-ended "or equivalent."

## Rationale

The spec targets the right seam and correctly follows hollow-pin as precedent. The gaps are contract completeness, not architecture: verification scope (`test:v1`), untested sibling composition, decisions without AC backing, and intent language that overstates enforcement. Closing these brings the written contract to hollow-pin's adjudicator bar and satisfies downstream keystone prerequisites (composition, empty-subspec reporting, detection surfacing vs mandatory rewrite) without splitting the subspec.

## Not required

- Repeating prerequisites in the subspec (hollow-pin is merged; implement fails fast if hooks are missing).
- Machine-verifying "fails against pre-fix review roles" during plan review (standard failing-test convention for first implement run).
- Inlining `@mutate` path/anchor in AC prose if the test file follows hollow-pin's established pattern (exact test title + directive in test body).