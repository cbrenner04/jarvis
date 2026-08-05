Verifying key code claims so the verdict rests on repo facts, not only the advocate summary.
## Verdict: required refinements

### Blocking — incorrect or untestable acceptance outcomes

1. **Fix the subspec 01 integration fixture AC (and matching intent AC).** The named human-only completed subspec pins `` `write.test.ts` `` by basename only; the repo has two `write.test.ts` files (`v2/src/execution/` and `v2/src/commands/`). Under path-first resolution with ambiguous-basename failure, that fixture cannot satisfy “zero unparseable and two caught.” The spec must name a fixture whose pinning references are already path-qualified, or replace the named fixture with a dedicated one authored for this behavior.

2. **Correct the pin-title / no-directive-match outcome in subspec 00 (and intent).** After dropping the all-directives fallback, a criterion that resolves a pinning file but names no matching pin title yields **hollow** (no linked directive), not `unresolved_pinning_test`. `unresolved_pinning_test` is for pinning-**file** resolution failures. The AC and intent prose that conflate these must align with the decision to drop inherited directives.

3. **Decide and state unparseable gate scope in subspec 00.** Intent says blockers carry criterion text; today unparseables are file-level rows with no criterion attribution, and parsing a pinning file collects all file unparseables when any criterion opens it. The spec must normatively choose **file-scoped** blocking (any unparseable in a referenced pinning file blocks completion; blocker cites file/line) or **criterion-scoped** blocking (only unparseables tied to the active criterion block; blocker carries criterion text). Leaving this implicit will produce inconsistent write-boundary checks.

4. **Narrow or justify stranded-mutation completion scope in subspec 03.** A blanket “replacement present ∧ original absent” scan on staged/committed content can refuse legitimate implementations that intentionally land the replacement text after clean verification and restore. The spec must either scope refusal to directives **applied during the current write-step verify and not confirmed restored**, or explicitly accept the false-positive tradeoff and document author reconciliation when implementing guarded changes. The problem statement targets abnormal verification settle; the decision must match that intent or state the broader policy deliberately.

5. **Add mutation-checkpoint guard-inversion pins for subspecs 01 and 02.** Spec guidance requires every new/modified runtime guard to have a pinning `@mutate` that turns RED when the guard is reverted. Subspec 01 (path resolution / unresolved blocking) and subspec 02 (abort/timeout/snapshot restore) add guards without pins. Each subspec needs at least one named pin AC, or a documented exemption—the requirement cannot be skipped silently.

### Blocking — spec-guidance and contract completeness

6. **Add a preservation AC in subspec 00 for unchanged `Mutation checkpoint:` selection.** Subspec 00 narrows `@mutate` selection but claims the phrase marker is unchanged. Per refactor-AC guidance, cite an existing test that must stay green (e.g. the verify-directive-only hollow/pin-linkage test), not only assert new narrow-selection behavior.

7. **Pin each write-boundary refusal AC to a single test file.** Subspec 01’s “unresolved pinning test blocks completion” must not use “via `write.test.ts` or direct boundary wiring.” Completion-boundary `contract_miss` assertions belong in `write.test.ts` with explicit test names; verifier-only behavior stays in `mutation-checkpoint-verifier.test.ts`.

8. **Task explicit reconciliation of contradictory committed tests and docs in subspec 00.** Existing tests encode bare `@mutate` selection and stderr-only unparseable; operator-runbook § Gate trust matches the pre-fix contract. Subspec 00 must require updating or inverting those suites and docs in the same slice that changes behavior—not only “add regressions.”

### Required clarifications (implementer divergence risk)

9. **Define “comment-leading `@mutate`” normatively in subspec 00.** State the predicate used to exclude string-literal false positives (e.g. line must be a `//` comment containing `@mutate`). Without it, implementers will diverge on `/* */`, `#`, and inline comments.

10. **State path-qualified resolution edge rules in subspec 01.** When the backtick reference contains a path separator: normalize to repo-relative POSIX paths; resolve under worktree root with escape-root rejection; **no basename fallback** if the qualified path does not resolve. Missing or ambiguous basename (no separator) remains `unresolved_pinning_test` with criterion text, raw reference, and reason.

11. **Specify abort/timeout termination semantics in subspec 02.** Wiring `AbortSignal` and a per-directive `min(remaining iteration wall, 180s)` budget is insufficient without stating how real scoped `bun` subprocesses are stopped (cooperative cancel or kill). “Stop awaiting” alone does not satisfy “terminates and restores.”

12. **Clarify completion-boundary placement and failure taxonomy in subspec 03.** State that the stranded-mutation scan runs after `git add -A` into the temp index, reading **staged** blob content (and `HEAD` for the second regression)—not working-copy-only. Distinguish this **pre-commit completion refusal** from `surviving_mutation_failed` at ready finalization. Align task wording with staged-index semantics.

13. **State directive inventory source at completion in subspec 03.** The check must use the same verifier linkage path as the write boundary (re-parse active subspec / linked directives), not a divergent heuristic.

14. **Document internal task ordering within subspec 00.** The four changes are coupled: comment-leading filter before unparseable gate; drop all-directives fallback before unresolved blocking semantics; narrow selection before gate policy stabilizes. Tasks should reflect safe land order so intermediate states do not block completions on string-literal floods or misclassified hollow/unresolved.

### Documentation and traceability

15. **Subspec 00 operator-runbook AC must explicitly preserve `Mutation checkpoint:` selection** (intent requires “phrase marker unchanged”; current doc AC omits that line).

16. **Note in subspec 00 that non-blocking unparseable policy from the verify-directive-only cluster is superseded**—prevents implementers treating the prior verdict as binding.

17. **Subspecs 01–02 doc sections should note `v2/docs/v1-behaviors.md` is reconciled in subspec 03**, since behavior changes land before the catalog update.

### Not required

- **Split subspec 00** into smaller subspecs: the four changes are not independently safe to land out of order; bundling is defensible if ordering (#14) is documented.
- **`test:integration:v2` in every subspec**: acceptable omission unless subspec 03 adds integration coverage for completion wiring.
- **Optional edge cases** (fenced directive-shaped text, fragile pin string stability): clarifying only, not blocking merge-quality refinement.

### Rationale

These refinements close gaps between intent, observable repo state (duplicate `write.test.ts`, current `linkDirectivesToCriterion` → hollow path, contradictory tests), and spec-guidance (failing-test ACs, guard-inversion pins, refactor preservation ACs, agent-verifiable single-test naming). Without them, an implementer following the spec literally will hit failing fixture ACs, mislabeled failure reasons, ambiguous gate scope, possible false-positive completion blocks, and guidance violations on subspecs 01–02.