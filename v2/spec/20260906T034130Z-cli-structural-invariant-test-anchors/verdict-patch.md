Verifying the advocate's critical findings against the implementation and spec before issuing a verdict.
## Verdict

**1. Restore a fixed prepare-call allowlist ceiling (required).**

`production prepared-step assembly lives only in shared preparation and the pipeline adapter` passes `symbolResolvedMoveGuard` with `adapterPaths = every discovered caller except owner`. That makes the absence leg tautological: any new `prepareWorkflowStart(` site is auto-exempted. Subspec 03 requires pairing absence *outside* an allowlist with owner presence; only `{owner, pipeline adapter, CLI adapter}` may call. Assert discovered call sites equal exactly that fixed set (or equivalent export-resolved ceiling), then run move pairing against it—not against all discoverees.

**2. Loud-fail help-parity leaves with parser surfaces but no parser mapping (required).**

`parityGuardedPaths()` catches `parserAcceptedLongFlags` errors and drops the leaf. A new flagged `commandTree` leaf without a parser switch case is excluded silently and `helpFlagsParityGaps()` can return `[]` while it stays unguarded. Subspec 01 requires loud failure when building the guarded set; throw (or equivalent hard failure) instead of filtering.

**3. Reconcile audit mechanism prose for the two rows above (required).**

`cli-wsp-prepare-calls` references `discoverPrepareCallPaths` (not in codebase) and describes allowlisting while the branch uses discovery-as-allowlist. `cli-hfp-guarded-paths` claims loud-failure on missing help nodes but silently drops parser-unmapped leaves. Update both rows to match the corrected mechanisms.

---

**No actuator action:**

- **`intent.md` unchecked AC** — Jarvis-owned closure artifact; subspec/index work is complete.
- **Init profile inventory tautology** — matches subspec 02 decision (directory self-discovery, not independent registry).
- **Anti-vacuity `slice(0, -1)` pins** — weaker than per-subspec AC prose; subspec 00 move-regression fixture satisfies the intent-level regression requirement.
- **`symbolResolvedMoveGuard` exported from `.test.ts`** — expedient per subspec 00/03 reuse; maintainability nit, not a correctness blocker.
- **Manual `parserAcceptedLongFlags` switch, slice-boundary fragility, duplicate walkers** — accepted residual tradeoffs within spec scope.