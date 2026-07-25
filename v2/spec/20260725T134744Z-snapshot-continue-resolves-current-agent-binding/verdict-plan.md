# Adjudicator verdict: required spec refinements

## 1. Scope and operator paths (`role_timeout`, `--reset-despite-dirty`)

**Required:** Align intent and subspec with how recovery actually affects **implement-write binding**.

- **`role_timeout` / `role_stalled` / `retry_later`:** Do not state or imply that review-phase re-dispatch re-runs implement write or must pick up a new implement `adapterModel`. Limit claims to resumable write continuation (`jarvis run resume`, daemon auto-resume, and any path that actually re-enters snapshot-backed write binding). Where intent still mentions `role_timeout`, frame it as “no separate snapshot-binding replay mode” at the workflow layer, not as shared implement binding re-resolve with resume.
- **`--reset-despite-dirty`:** State explicitly whether binding proof is **continuation/resume-shaped** (primary) vs a dedicated workflow re-dispatch integration test. If intent keeps “clean slate uses current rung” for reset, the spec must say how that is satisfied (e.g. same `resolveWriteLoopBindings` / admission path as fresh step execution) or add an optional operator-path test—without overstating that reset always goes through `reconstructWriteResume`.

**Rationale:** Intent AC1/AC3 are about snapshot continuation; overstated paths create false acceptance and weak operator docs (spec guidance: behavioral ACs must match observable runtime behavior).

---

## 2. Execution vs persisted snapshot (`agentModelConfig`)

**Required:** Record an explicit product decision in decisions or documentation tasks:

- **Minimum for this change:** Continuation **execution** resolves binding from the current machine profile; persisted snapshot `agentModelConfig` may remain historical on disk until another change updates it.
- **Operator truth:** Docs must not imply snapshot JSON is binding truth after this change; telemetry (and run-list gap until the sibling spec) is how operators confirm the active rung.

Expand documentation updates to include **`v2/docs/write-behavior.md`** (or equivalent retry/snapshot prose) where snapshot vs live binding is described.

**Rationale:** Without this, implementers and operators can “pass” AC1 while list/TUI/docs still describe stale snapshot fields; intent already defers list divergence to a sibling.

---

## 3. Binding re-resolve choke points and audit (including queue)

**Required:** Replace open-ended “enumerate all resume paths” / “document intentional exceptions” with a **bounded contract**:

- Name the primary continuation choke point(s) (at minimum snapshot reconstruction into write-loop binding resolution).
- **Include queued-run promotion** (`queuedInput` serialized at queue time) in audit scope and in the guard AC—fixes limited to resume reconstruction alone are insufficient.
- **No AC-compliant “documented exception”** that still resolves from snapshot-persisted `agentModelConfig`; audit outcome is alignment, not a replay allowlist.

Clarify that **continuation keeps snapshot `step.agents`** and does not re-read `~/.jarvis/config.json` agent order (already in subspec); add that **“current machine profile”** means the same profile resolution as fresh admission (committed profile file + current `machineProfile` key), not only in-file rung edits.

**Rationale:** Intent AC3 and spec guidance require guard tests with invertible branches and agent-verifiable ACs; vague enumeration lets the subspec complete with a hole in queue or CLI paths.

---

## 4. Shrink continuation

**Required:** State that re-resolve uses the **same role mapping as today** for shrink continuation (e.g. hidden shrink → shrink role) when loading rungs from the profile.

**Rationale:** Advocate/code read: easy regression if re-resolve uses raw step role only.

---

## 5. Acceptance criteria quality (names, guard, admission, fixtures)

**Required:**

- **AC1 (profile edit → retry):** Name a **concrete** test file and/or `test(...)` title (not “extended or companion” alone). Cover snapshot-backed continuation after profile edit (resume and daemon reconciliation auto-resume as stated in subspec). Task: **update existing resume fixtures** that pin snapshot replay so expectations match current-profile binding after the fix.
- **AC2 (admission regression):** Reconcile with **intent AC2**. Either add coverage for “second admission after profile edit on a live daemon” or explicitly cross-reference intent AC2 and justify why the narrower “no restart” test is sufficient; subspec AC2 alone does not fully encode intent AC2.
- **AC3 (guard):** Define mechanism: choke-point assertion and/or **static allowlist** of modules that may pass `agentModelConfig` into write-loop binding resolution, each required to source from profile load; name what is **inverted** to prove the guard (flag or branch), scoped to call sites that pass `bindingResolution.agentModelConfig`, not every RPC named “resume.”
- **Docs:** Either a **worktree-verifiable** doc AC (e.g. forbidden phrasing removed from listed files) or keep doc updates as mandatory tasks with clear tick ownership—docs-only gaps should not be invisible at completion (spec guidance: agent-verifiable criteria).

**Optional (low priority):** Drop redundant process ACs (`typecheck`, full `test:v2` / `test:integration:v2`) if the refiner wants less checkbox noise; repo rules already require them.

**Rationale:** Spec guidance failing-test ACs must name tests that fail pre-fix; AC3 must prove guard inversion; harness ACs must not depend on network/CI.

---

## 6. Subspec structure

**Required:** **Do not split** the subspec solely for prose size if audit and AC3 are tightened as above. Split only if refinements still leave multiple independently shippable behaviors without a single coherent guard—current single subspec remains acceptable once queue, choke points, and AC3 are bounded.

**Rationale:** One observable behavior (“continuation uses current profile for binding”) with admission regression, docs, and structural guard is one commit-sized unit if the guard contract is defined.

---

## Summary

Before merge, the spec must: (1) correct `role_timeout` and clarify `--reset-despite-dirty` vs continuation proof; (2) document execution vs stale snapshot JSON and extend docs including write-behavior/retry identity; (3) pin choke points + queue promotion and forbid replay exceptions; (4) cover shrink role on re-resolve; (5) tighten AC1–AC3 with named tests, fixture updates, intent-aligned admission coverage, and a concrete guard contract. No further split unless bounded audit/guard still cannot be independently verified.