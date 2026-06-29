## Verdict — required refinements

### 1. Close `role-resolution.md` deferral contradiction
The subspec must require retracting or revising the `v2-build-order.md refresh deferred` decision in `role-resolution.md` when build-order is updated. Add that file to **Documentation updates** and a **Decisions** entry. Leaving the deferral in place contradicts the work this subspec performs and violates single-home doc policy.

### 2. Add `## Prerequisites`
Mirror intent prerequisites: role keys documented as v2 invocation-resolution keys; `AgentModelConfig` and per-agent per-role escalation documented in durable v2 docs. Enables plan-mode validation and states the merge precondition for implementers.

### 3. Strengthen acceptance criteria for cross-cutting build-order edits
AC #3 bans stale strings file-wide but does not require positive rewrites the task checklist mandates. Add criteria (or extend existing ones) that Phase 1’s forward reference and Cross-cutting Quota bullets name a **role→model store** and role-based resolution composition (outer agent fallback, inner rungs per `agent-model-config.md`), not only the absence of `category` wording.

### 4. Cover Phase 5 Retires clause and `category→model store`
Lines 101–102 (`steps name categories in source`, `category→model store`) are in-scope Phase 5 prose. Extend banned-string targets and acceptance criteria to include `category→model store`, `steps name categories`, and equivalent category-as-resolution-key phrasing.

### 5. Define dependency wording as “on `main`”
ACs #2 and #5 use “merged” ambiguously. Require wording that Phase 5 planning/implementation depends on `role-resolution.md` and `agent-model-config.md` **committed on `main`** (or equivalent: present in durable docs at implementation start). Aligns with intent prerequisites and avoids “merged PR” vs “on branch” ambiguity.

### 6. Tighten meta-index AC #4
The Phase 5 line must minimally encode: role-named steps, role→model store (not category store), `(agent, role) → rungs`, hard error on missing required `(agent, role)` at load. Full escalation prose stays in build-order; meta-index stays compressed but complete on contract tokens.

### 7. Clarify AC #3 Phase 6 exemption
Exemption applies only to `reviewing-class` / `executing-class` in `### Phase 6` debate-structure prose — not the entire Phase 6 block. Makes file-wide grep/review unambiguous.

### 8. Record load-bearing decisions the subspec omits
Add decision entries for:
- **Advisory design gate** — “blocked” is explicit prose dependency in tracking docs; no harness/plan/run mechanical gate — rules out scope creep into workflow enforcement.
- **`v2-vision.md` shorthand** — vision may keep `(agent, role) → model`; build-order follows `agent-model-config.md` precision `(agent, role) → rungs` — rules out treating vision line as blocking inconsistency or requiring vision edit in this subspec.

### 9. Optional, non-blocking
Meta-index file-wide negative AC (no category resolution keys outside Phase 5 line) is cheap insurance if the file grows; not required today given single affected line.

---

**Net:** Spec direction and scope are sound for a doc-alignment slice. Refinement must close the `role-resolution.md` contradiction, add prerequisites, and tighten ACs so cross-cutting edits, Retires-clause removal, and dependency preconditions are verifiable — without expanding to harness gates or `v2-vision.md` edits.
