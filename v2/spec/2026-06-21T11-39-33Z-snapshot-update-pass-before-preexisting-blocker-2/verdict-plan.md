## Verdict — Required Refinements

The core architecture is sound (fail-safe-to-stand, shared bound, mutate-only-after-base-ref-declined, reusing the `blocker-rejected` kind). The following must be tightened before implementation. All are clarifications, not redesigns.

### Subspec 00

1. **Pin the gate's exact control-flow position.** The decisions say "after base-ref validation declines to reject" and "before the blocker-stands commit," but the commit+exit-7 block is *shared* between the base-ref-red branch and the non-claim/git-off/bound-hit branch. A naive reading could place the gate where it fires for non-claim or bound-hit blockers. The spec must state that the gate lives **only in the branch reached when the blocker is a claim, git is on, the bound is not hit, and base-ref ran red** — not in the shared commit path. This is the spec's main weak point; ambiguity here is a real implementation hazard.

2. **State the base-ref-seam coupling explicitly.** The gate is structurally reachable only when the base-ref validation seam was wired and ran (it lives inside that guard). The spec presents the two gates as peers ("shares the bound with base-ref") while subordinating one to the other. This is a legitimate design choice (it matches "mutate only after the cheaper read-only check declined"), but it must be **written down**: the snapshot gate runs only when base-ref validation executed and went non-rejecting, which production guarantees by wiring both seams together. Don't leave it implicit.

3. **Pin the counter increment/reset ordering.** The red base-ref branch already calls `resetRejectionCounter()`. The green-rejection idiom elsewhere does reset-then-increment. The spec must state that, in the gate's branch, the reset has already run, so a snapshot-churn rejection performs the increment only — to prevent a double-reset copied from the other idiom. The bound AC depends on this being correct.

### Subspec 01

4. **Add a diagnostic on every non-green / fail-safe outcome.** Today only the green rejection logs/emits; unresolvable command, missing/unreadable `package.json`, update-tool error, and still-red re-test all collapse to a silent `false` and the blocker stands with no signal. This defeats the intent's purpose ("don't let snapshot churn halt the run") for the operator whose blocker stood *only because `updateSnapshotsCommand` was unconfigured*. The spec must require a log/breadcrumb in 01 that distinguishes "could not resolve update command" from "ran update, suite still red." Keep 00's seam a bare boolean; the diagnostic belongs in 01 where resolution happens.

5. **Define the string→argv execution strategy.** Existing runners use clean `execFileSync("bun", ["run", "test"])` argv with no string parsing. Both a configured `updateSnapshotsCommand` (arbitrary string) and the detected `bun run <script>` are strings with no defined tokenization. The spec must pin how the command string becomes an exec invocation (e.g. whitespace tokenization to head+args, or a documented shell invocation). This is load-bearing.

6. **Pin detection precedence.** "First match wins" is ambiguous between candidate-list order and `package.json` key order. State which (candidate-list order, as the list is written). One line.

7. **Name the end-to-end test approach.** The 01 AC asserts a blocker is rejected "end-to-end without any injected seam," but the task checklist lists only resolver/runner unit tests. The spec must name how the without-seam path is verified (e.g. a temp git repo fixture with a stale snapshot plus an update script that clears it), or the AC is unverifiable as written.

### Minor — one-line acknowledgments (not blockers)

8. **Repo-root `package.json` assumption** — state that detection reads the target repo's root `package.json`; the monorepo case can use the existing `Deferred to first consumer` pattern.
9. **Default-seam wiring source** — note it wires from `preflight.cfg` (project config) + `preflight.agentWorkingDir`, mirroring the base-ref default; both are confirmed in scope at the wire point.
10. **Kill-before-commit window** — acknowledge that uncommitted snapshot updates are lost if the run ends before the next commit, identical to the existing base-ref strip path.

### Not upheld

- The request to add an asymmetry note justifying `bun run test` for re-test (vs. the non-hardcoded update command) is already covered by an existing 01 decision bullet. No change needed.

**Rationale:** Findings 1–3 are required by the spec-guidance principle that harness subspecs must make structure-as-contract explicit; the shared commit block and shared counter make implicit placement a correctness risk. Finding 4 follows directly from the intent's stated purpose. Findings 5–7 close genuine unspecified gaps in 01 that an implementer cannot resolve from the current text without guessing.