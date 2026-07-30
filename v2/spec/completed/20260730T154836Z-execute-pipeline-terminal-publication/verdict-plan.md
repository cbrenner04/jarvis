Reviewing the codebase and sibling specs to ground the verdict on completion vs terminal publication boundaries.
## Verdict: Refinement required

The spec is sound as an atomic **terminal publication executor** (gate-before-mutation ordering, injectable seams, PR preservation on failure). It is **not** yet sufficient to guarantee the intent’s product outcome without clarifying how this module composes with implement completion and the settle sibling. Refine as follows.

### 1. Pin the completion ↔ terminal composition contract

**Required outcome:** Decisions must state how implement completion and terminal publication interact across all three actions, especially `leave-draft`.

- Today, completion always runs ready finalization after PR create (`publishCompletionArtifacts` → `runReadyFinalizer`). The executor correctly defines `leave-draft` as zero gate/flip/merge, but that alone cannot leave a draft PR if completion already flipped it.
- The spec must explicitly record that **completion ready-finalization coordination is out of scope for this subspec** and is a **settle (or upstream wiring) obligation**: when `terminalAction` is `leave-draft`, completion must not ready the PR before terminal publication runs.
- For `ready` and `merge`, pin the intended model: terminal assumes completion has produced PR evidence; terminal may re-run gate and an idempotent ready flip before merge; this is the enforcement boundary at pipeline settlement, not a duplicate of the full completion verifier stack.

**Rationale:** Without this handoff, slice 5 can ship a green unit-tested module that still fails configured `leave-draft` end to end. The settle intent already depends on this executor but does not yet name the completion prerequisite.

### 2. Document settle handoff and intentional orphan status

**Required outcome:** The subspec must state that this surface is **not invoked by production code until settle lands**, and that full product semantics (especially `leave-draft`) require settle wiring completion + terminal publication serially.

**Rationale:** Prevents reviewers from treating missing pipeline integration as accidental scope slip; aligns with `implement-queue.md` slice ordering.

### 3. Pin minimal input, success, and error contracts for settle consumers

**Required outcome:** Decisions must cover:

- **Missing PR evidence:** `ready` and `merge` fail fast before any `gh` call when `prNumber`/`prUrl` are absent; `leave-draft` may succeed with optional passthrough evidence.
- **Success shape:** success echoes retained `prNumber` and `prUrl`.
- **Failure shape:** typed failure names `terminalAction` and wraps a normalized publication failure; specify how `ReadyGateError` fields (`timedOut`, `gateFailureKind`, out-of-scope classification) map into that wrapper so settle and `v1-behaviors.md` stay consistent.
- **Merge failure labeling:** pin the normalized operation label used for merge failures (e.g. `"gh pr merge"`) even though merge flags/idempotency remain deferred.

**Rationale:** Settle is the first consumer; underspecified contracts force rediscovery at wiring time.

### 4. Tighten acceptance criteria to match decisions

**Required outcomes:**

| Gap | What the AC must verify |
|-----|-------------------------|
| Ambiguous title | Rename `executes each configured terminal action in order` to reflect **once per action type** (three invocations / cases), not one pipeline running all three. |
| Red gate incomplete | Red-gate criterion must assert **zero ready-flip calls** as well as zero merge calls (decision blocks *every* post-gate mutation). |
| Failure scope narrow | Extend or add a criterion covering **gate failure** (not only flip/merge mutation failure): error names action, wraps failure, PR evidence retained, no close/delete. |
| Missing-input path | Cover fail-fast behavior for `ready`/`merge` without PR evidence. |
| Guard inversion vacuity | The bundled guard-inversion AC must require a **non-vacuous** negative test for failure preservation — e.g. injectable close/delete seams or a shared `gh` fake call log — so inversion can prove spurious close/delete. |
| Intent drift | Sync `intent.md` with the subspec’s fourth guard-inversion AC (spec guidance requires guard inversion for runtime guards). |

**Rationale:** Current AC #2 under-specifies the red-gate decision; AC #3 omits gate failures; the fourth AC’s close/delete inversion is untestable on greenfield code without an explicit seam requirement.

### 5. Optional but recommended

- Lightweight docs AC tying `workflow-runner.md` and `v1-behaviors.md` updates to completion/terminal composition and failure classes.
- One explicit “intentionally excluded” decision line for the completion verifier stack (`requiredIntegrationScope`, mutation/smoke verifiers) to forestall parity debates.

---

**Not required:** Splitting the subspec (one module, one test file is appropriately atomic). Folding completion changes into this subspec (different seam — belongs in settle/upstream wiring). Prescribing `specPath` on the terminal gate input (lighter re-gate at settlement boundary is defensible).

**Bottom line:** Approve the executor scope and test strategy; **block merge until completion/terminal composition, settle handoff, and the AC gaps above are addressed.** The central risk is a correct isolated module that does not connect to the configured terminal action product outcome.