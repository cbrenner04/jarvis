## Verdict — required refinements

1. **Collapse the delete task** — Replace the two-step “delete lines 55–167, then delete file” checklist item with a single outcome: delete `state-store-types.ts` after survivors are moved and importers repathed. The intermediate line-delete is redundant once the file has no unique exports and is order-sensitive noise.

2. **Drop brittle line numbers** — Remove `55–167` from the task checklist. Stale-half rationale already names the symbols (`AttemptStatus`, duplicate `OutcomeKind`/`Run`/`Attempt`, unused `Outcome`, stale `StateStore`); line anchors will rot.

3. **Add missing preservation AC** — `daemon-wait-run-completion.test.ts` type-imports `RunStatus` from the old module and has no “stays green” pin. Per refactor AC guidance, add `- [ ] daemon-wait-run-completion.test.ts stays green.`

4. **Restore `## Prerequisites`** — Intent gates on seed 01 (lean doc-comment standard + in-process daemon-test defaults). Subspec’s “move only / no doc-comment churn” assumes that standard is landed. Restore a `## Prerequisites` section on the implementable subspec pointing at seed 01 so plan-mode validation lives on the artifact patch agents run.

5. **Clarify the `isRunStatus` value-import boundary** — The decision “Persistence→execution imports stay `import type` only” does not cover `daemon-wire.ts`, which already value-imports `isRunStatus` from persistence (host→persistence, not persistence→execution). After consolidation the source becomes the heavier `state-store.ts`. Add one decision recording that this host value-import is intentional carry-forward (same symbol, same import kind), not a new persistence→execution violation and not grounds to extract `isRunStatus` elsewhere. Without it, a competent implementer could misread the type-only rule and over-correct.

6. **Align `intent.md` survivor wording** — Intent still says “move … one `OutcomeKind`”; subspec correctly keeps the canonical `OutcomeKind` already in `state-store.ts` and deletes the duplicate. Intent should match the subspec decision so seed and implementable artifact do not contradict.

## Upheld without change

- Subspec `OutcomeKind` decision, grep-guarded repath task, structural `v2-architecture.md` AC, `v2/src`-scoped `rg` AC, `v1-behaviors.md` / `state-store.md` out-of-scope, dual-import merge implied by repath, symbol placement left to implementer, separate doc-prose AC unnecessary, `AgentModelConfig` edge grandfathered by relocation only.

## Rationale (summary)

Items 1–2 reduce implementer confusion and spec rot. Item 3 closes a refactor coverage gap the adversary identified and spec guidance requires. Item 4 restores a prerequisite gate the intent declares but the subspec dropped. Items 5–6 close decision-scope ambiguity that could produce wrong import refactors or contradictory seed/subspec reads. No other adversary findings require spec change beyond what the advocate already conceded.
