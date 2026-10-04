Verifying a few codebase claims so the verdict rests on concrete spec gaps, not only the advocate summary.
# Verdict: gate-repair-fence spec draft

**Status: not ready to merge.** The intent’s behavioral model is sound; the staged decomposition does not faithfully route or bound it. Refinement is required before implementation.

---

## Required refinements

### 1. Restore complete index routing (blocking)

`index.md` lists only `03` and `04`, omitting `00`–`02` and `05`. An index-routed run would skip the biome pin, base-ref classification, write fence, and autofix verification — the problems the intent names. The index must link every subspec in dependency order: `00` → `01` → `02` → merged resume subspec → `05`.

### 2. Merge same-seam `03`/`04` into one subspec (blocking)

`03-daemon.md` and `04-execution-loop.md` duplicate the same problem, decision ledger, tasks, and tests across write-loop projection, `composeRunOperatorError`, and daemon/workflow-runner resume admission. This contradicts the intent (“single execution-loop surface; splitting by module boundary does not apply”) and spec guidance (same-seam siblings serially, not in parallel). One subspec must own all non-resumable `ready_gate_out_of_scope` behavior and be the sole index entry for that slice.

### 3. Make preservation tests explicit about base-ref fixtures

Preservation ACs cite tests that assume diff-only out-of-scope semantics (`ready-finalize.test.ts` “classifies fully attributed terminal failures outside the allowed set as out of scope”; `write-loop.test.ts` “never invokes repair for a fully attributed untouched-path gate”). Under base-ref scope, outside-diff paths that pass on `baseRef` become in scope — those tests will flip unless fixtures stub base-ref reproduction as failing for out-of-scope cases. Subspec `01` must require fixture/probe-stub updates for preservation paths and complementary stubs for new in-scope outside-diff regressions. Without this, preservation ACs are false against the new discriminator.

### 4. Pin heterogeneous multi-path base-ref settlement

When attributable failing paths mix (some pass on `baseRef`, some fail), the spec must state settlement: in scope with per-path allowset extension, out of scope only when all fail on base, or another single rule. Intent implies per-path probing but does not pin mixed-result behavior.

### 5. Reconcile probe-error reporting with “deferred” wording

`01` defers exact `ReadyGateError` probe-error surface but intent/`01` AC require “probe error is reported” at write-loop integration. The spec must name the observable reporting channel (log event kind, repair-entry context, or operator-visible field) so implementers know what “reported” means without contradicting “deferred.”

### 6. Document supersession of completed resume-finalization spec

This intent narrows landed behavior from `v2/spec/completed/.../04-resume-out-of-scope-gate-finalization.md`: `ready_gate_out_of_scope` was admitted for finalization retry with `resumable: true`; this work makes unchanged-path out-of-scope non-resumable and rejects resume admission. The merged resume subspec must call out which completed ACs are superseded and which touch points change (`run-operator-error.ts` `nextAction`, resume admission sets, operator remediation strings).

### 7. Cite workflow-runner preservation tests that will flip

Intent names `write-loop.test.ts` and `daemon-resume.test.ts` but `workflow-runner.test.ts` asserts `resumable: true` and `nextAction: "resume"` for `ready_gate_out_of_scope` (e.g. “settles an attributed untouched red gate…”, “persists ready_gate_out_of_scope evidence…”). The merged resume subspec must cite these as preservation/update targets so the full operator surface is covered.

### 8. Pin terminal non-resumable operator contract

“`nextAction` other than `resume`” is underspecified. The spec must pin the expected terminal action (`stop` or whatever the harness uses for non-resumable failures) and define “unchanged outside paths” (set equality against first settlement, behavior when the tree changes but the attributable path set does not).

### 9. Scope review-row resume behavior

Intent AC names ordinary write-row `daemon-resume.test.ts` coverage only. After non-resumable settlement, review/publication-tail resume behavior is undefined. The merged resume subspec must state whether review-tail rows follow the same admission rejection or retain different semantics, with AC coverage if behavior changes.

### 10. Carry intent’s plausibility predicate or narrow explicitly

Intent: out-of-scope stays non-resumable “unless a resume could plausibly change the outcome.” Subspecs only specify the unchanged-path case. Either restore the broader predicate with boundaries or state explicitly that only unchanged-path `ready_gate_out_of_scope` is in scope for this spec.

### 11. Clarify per-gate allowset lifecycle

`01` adds failing paths to the repair allowset “for that gate only” but does not say whether extension is recomputed per repair entry or persisted on the fence row. One decision-ledger line must bound persistence vs recompute so `02`/`05` fence validation has a stable contract.

### 12. Own operator-facing out-of-scope semantics drift

Out-of-scope meaning shifts from diff membership to “fails on base too.” Doc tasks mention this but no AC or task owns updating `formatReadyGateOutOfScopeDetail`, `workflow-runner.md` diff-based language, or `outsidePaths` operator strings. At least one subspec must require those strings/docs to match the new meaning.

### 13. Resolve `02`/`05` autofix-fence sequencing

`02` unifies fence validation for autofix and agent repair; `05` inserts typecheck between autofix and fence commit. Index order or task text must make clear that autofix fence unification completes in `05`’s seam so implementers do not land inconsistent intermediate states.

### 14. Pin autofix discard log contract

`05` and operator-runbook prose describe discard logging but no AC names the event kind or fields operators see via `jarvis run log`. One behavioral AC (or explicit harness-structure AC) should pin observability so “records the discard with the failing output” is verifiable.

### 15. Split `05` happy-path AC and add named failing-test anchor to `00`

`05` bundles revert-on-failure and unchanged happy-path in awkward compound wording — split into two distinct ACs per intent. `00`’s regression AC lacks a named test anchor per spec guidance; cite the pinning test file and name. Optional: name the Biome rule in the task checklist.

### 16. Consolidate `v1-behaviors.md` ownership for resume change

Intent bundles `v1-behaviors.md` updates for base-ref scope and write fence; merged resume subspec omits `v1-behaviors.md` while changing durable resume contract. The merged subspec must own its `v1-behaviors.md` slice.

### 17. Keep full-suite gate only on final subspec

`05` alone carries `bun run typecheck` / `test:v2` / `test:integration:v2`. Acceptable only if corrected index enforces serial landing with `05` last; otherwise intermediate merges lack a suite gate.

---

## Rationale

Blocking items (1–2) would cause Jarvis to implement the wrong work or duplicate same-seam changes — direct violations of index-routed spec conventions and the intent’s single-pipeline framing. Items 3–16 close gaps where preservation ACs would fail or flip silently, completed-spec behavior would reverse without acknowledgment, or operator/daemon contracts remain ambiguous. The intent design (base-ref scope, fail-open probe, attributable fence, verified autofix, biome pin) needs no rethink; the draft must make implicit fixture, supersession, and operator-surface obligations explicit so each subspec is independently implementable and testable.