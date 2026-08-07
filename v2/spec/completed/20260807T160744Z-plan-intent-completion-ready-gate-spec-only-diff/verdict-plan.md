Validating key codebase claims before issuing the verdict.
## Verdict: required refinements

### 1. Resolve intent workflow scope for problem 1 (blocking)

The spec promises scope relief for both **plan** and **intent** completion, but `classifyChangedPaths` / `NO_TEST_IMPACT_PATTERNS` on main cover `v1/spec/**`, `v2/spec/**`, docs, and `reports/**` — not `ready-intents/**` (intent durable output). Intent-only diffs therefore never resolve to empty test scope today, even with a resolvable base.

**Required outcome:** The spec must make an explicit product decision and align intent, decision ledger, tasks, and acceptance criteria to it — either (a) extend no-test-impact classification to intent landing paths (and any other markdown-only completion roots the workflow uses), or (b) narrow problem 1 to plan completion and state that intent scope relief is settlement-only in this spec. Leaving “plan/intent” in scope prose while only pinning `v2/spec/**` tests is internally inconsistent and will strand intent runs on the narrated failure mode.

**Rationale:** Intent title and ACs name both workflows; implementers cannot infer the carve-out from code alone.

---

### 2. Unify “spec-only” terminology (blocking)

The draft uses three overlapping definitions: intent prose (`v1/spec/**` / `v2/spec/**` only), classifier predicate (`classifyChangedPaths` → `[]`), and settlement predicate (markdown-only workflow + outside attribution + non-markdown repair shape).

**Required outcome:** Adopt distinct, cross-linked terms (e.g. “no-test-impact diff” for scope, “markdown-only plan/intent completion” for settlement) and use them consistently in the decision ledger, task checklist, and acceptance criteria. Where they diverge (e.g. docs-only diffs vs plan-tree landing), say so once in the ledger.

**Rationale:** Ambiguous “spec-only” will cause wrong guards and docs that over- or under-promise behavior.

---

### 3. Specify the settlement guard predicate and ordering (blocking)

Settlement ACs describe the desired outcome (`ready_gate_out_of_scope` instead of `completion_commit_failed`) but not the detectable conditions or where the guard runs relative to existing `classifyReadyGatePublishFailure`, autofix, and `enforceRepairIterationFence`.

**Required outcome:** The spec must state, in decision-ledger or task form, the observable predicate stack for early settlement (workflow kind, diff/attribution shape, repair-shape that cannot succeed within markdown roots) and that settlement runs **before** autofix and repair attempts that can hit the markdown fence — not only before the final fence commit check. Clarify behavior when classification stays `ready_gate_failed` (e.g. base-ref probe errors) but the failure is still fully outside-diff and repair would stage only non-markdown paths.

**Rationale:** Without this, implementers may patch only the fence path or run autofix first and leave the stranding mode reachable; spec guidance expects behavioral ACs to be falsifiable, not guessed at implement time.

---

### 4. Keystone checkpoint needs a concrete `@mutate` anchor (blocking)

The keystone AC refers to “reverting the spec-only out-of-scope settlement headline” with no linked one-line replacement target.

**Required outcome:** Add a `Keystone checkpoint:` criterion whose `// @mutate` directive in the named pinning test names a unique, stable source line (guard branch or early-return) that reverts headline behavior to baseline (`completion_commit_failed` or repair entry).

**Rationale:** Spec guidance requires a verifiable keystone; prose-only keystones risk `unresolved_pinning_test` or `Inert headline change` at completion.

---

### 5. Symmetric guard mutation for intent settlement test (required)

Plan settlement has a `Mutation checkpoint:`; the mirrored intent test does not.

**Required outcome:** Either add a mutation checkpoint on the intent pinning test (same guard, inverted) or document in the spec why a single plan pin suffices for a shared guard (and accept weaker coverage). Default expectation per spec guidance is symmetric guard pinning when two workflow tests exercise the same guard.

---

### 6. Update preservation of the unresolvable-base classifier contract (required)

Existing test `unresolvable base runs full suite regardless of paths` will become misleading once no-test-impact paths are exempted.

**Required outcome:** Acceptance criteria or tasks must require updating that test (rename, narrow assertion, or sibling test) so the deliberate exception — no-test-impact + unresolvable base → `[]`, code-bearing / empty / root-tooling + unresolvable base → `full` — is pinned and the old universal claim is removed.

**Rationale:** Refactor/preservation ACs should cite tests, not paraphrase; a lying test name invites regressions.

---

### 7. Record defense-in-depth and shared-classifier scope (required)

Fixing problem 1 for plan spec-only + unresolvable base removes the narrated test-failure → repair chain for that scenario; problem 2 must stand on its own.

**Required outcome:** One decision-ledger entry stating that settlement is defense-in-depth for markdown-only completions that still enter the gate/repair path (non-test failures, probe/classification edge cases, intent paths that still run tests if problem 1 is narrowed). Separately record that changing `resolveCiTestScope` applies to **all** no-test-impact diffs (including docs-only implement runs), as intentional parity with resolvable-base behavior — not an accidental bleed.

**Rationale:** Ties intent to observable reachability; documents intentional partial reversal of the unresolvable-base `full` fallback without silent behavior change elsewhere.

---

### 8. Optional but recommended (non-blocking)

- Copy intent **Prerequisites** into the subspec for implement-agent context.
- Add an AC or preservation note for `deriveReadyGateChildEnv` / `ready-finalize` wiring if scope relief should be proven end-to-end, not only at `resolveCiTestScope` unit level.
- One-line ledger boundary: repo-wide `check` / `typecheck` / `lint:md` remain on empty test scope; unrelated non-test gate failures are out of scope for problem 1 but may still be covered by the settlement guard when repair shape matches.

---

### Not required

- **Subspec split:** One execution-loop seam with independently verifiable classifier and settlement slices; intent scope extension stays in the same boundary. No split mandated.
- **Automated docs ACs:** Documentation updates section is sufficient per repo convention.