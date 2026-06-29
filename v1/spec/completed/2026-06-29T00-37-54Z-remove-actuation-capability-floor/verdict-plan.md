## Verdict — refinements required before merge

### 1. Rejection ACs are not achievable from current tasks

Intent and three `00` acceptance criteria require load-time **rejection** of `actuationCapabilityFloor`, `capability`, and `patchActuator`. Today:

- `capability` is whitelisted in `validateAgentOrder` — removal silently strips it.
- `actuationCapabilityFloor` has no top-level allowlist — removal silently ignores the key.
- `patchActuator` rejection is already wired via `validatePatchSubRoleAgentOrder`.

**Required outcome:** `00` must pin reject-at-load as the contract and include tasks + tests for unknown-key/unknown-field validation on the two surfaces that currently strip/ignore. Do not narrow ACs to silent ignore without revising intent.

---

### 2. `00` Problem misstates shrink coupling

Problem claims the floor "only filters agents named by the `patchActuator` sub-role." Shrink applies the same helper to the **`reviewActuator`** ladder, not `patchActuator`.

**Required outcome:** Correct Problem/Decisions to state floor applies independently to impl-loop (`patchActuator` resolution in preflight) and shrink (`reviewActuator` resolution). Shrink decision (keep `reviewActuator`, drop floor) stays; coupling prose must not.

---

### 3. Shrink behavioral delta is unpinned

When floor would empty the shrink ladder, shrink today skips with a stderr error and preserves run outcome. After removal, shrink runs the full `reviewActuator` ladder — a deliberate behavior change intent implies but does not pin.

**Required outcome:** `00` must decide and AC the post-removal shrink behavior for configs that previously hit empty-post-floor skip; task must remove shrink's empty-eligible early-return (~438–445).

---

### 4. `capability` removal scope is wider than AC #2

Removing `capability` from `AgentEntry` rejects it on **every** `validateAgentOrder` path, not only `modes.patch.agentOrder`. Existing test `"allows capability in plan mode agentOrder (ignored)"` will fail.

**Required outcome:** Widen AC #2 to global rejection (or add per-mode tests); flip/replace the plan-mode round-trip test.

---

### 5. Test tasks are incomplete

Current delete-only test plan drops coverage and leaves stale references:

| Gap | Required outcome |
|---|---|
| Whole-file delete of `patch-actuator-floor.test.ts` | Relocate non-floor `buildActiveAgents` tier tests first; delete floor + `patchActuator` cases only |
| `config.test.ts` "floor-related" scope | Rewrite `patchActuator` resolver/allowed-keys tests (~131–157, ~2441–2497), not just floor validation cases |
| New rejection ACs | Add config-load rejection tests for all three removed surfaces |
| `run.test.ts` | Remove/update empty-eligible floor + shrink floor-source tests |
| `run-summary.test.ts` `floor-error` mapping | Decide fate of `exitReason: "floor-error"` (remove path + mapping vs keep for historical records); task + test update |

---

### 6. Missing code-removal tasks

**Required outcome:** Explicit tasks for: shrink empty-eligible early-return removal; `floor-error` exit-reason path in `run.ts`; `filterAgentsByCapabilityFloor` export/import cleanup; `run-summary` mapping update per decided fate.

---

### 7. Documentation subspec gaps vs intent

Intent requires dropping floor/`patchActuator` concepts **and** documenting `reviewActuator` as the actuator-tiering lever. `01` scrubs symbols but:

- Omits `v1/docs/operator-runbook.md` ("tier/floor/override" at ~320)
- Omits residual "floor" prose in `run-loop.md` (~791, 799) and `v1-behaviors.md` pool-contention bullet (~47)
- Adds no positive `reviewActuator` guidance (intent asks for this; `agents.md` patch-impl fix alone is insufficient)

**Required outcome:** Broaden `01` tasks and ACs to repo-wide scrub of `actuationCapabilityFloor`, `patchActuator`, capability-floor prose across all listed docs; add positive `reviewActuator` tiering guidance in `agents.md` and/or `config.md`.

---

### 8. Decision ledger gaps in `00`

**Required outcome:** Add Decisions entries for:

- Reject-at-load for floor + `capability` (rules out silent strip/ignore)
- Intentional removal of impl-loop tiering via `patchActuator` (rules out floor-only deletion leaving sub-role)
- Relocate vs delete tier tests (rules out whole-file delete)
- Shrink skip-path removal (rules out preserving empty-post-floor behavior)
- `floor-error` telemetry fate (rules out leaving dead exit reason)

Optional, non-blocking: one-line note that floor removal may change `actuatorAgents[0]` reuse in review when floor had altered impl primary — informational side effect; rewiring to `reviewActuator` resolution is out of scope.

---

### 9. Coordination note (non-blocking)

Parallel spec `role-resolution-taxonomy` may touch `v1-behaviors.md`. Merge order or reconcile when both land; this spec's direction (delete `patchActuator`) should win.

---

### Defended — no refinement required

- Code-then-docs split (`00` / `01`) is acceptable; transient mismatch closes in `01`.
- `00` "Documentation updates: None" is fine for the code subspec.
- `patchActuator` → direct `agentOrder` migration is already covered by intent + AC #4; explicit break AC is optional.
- Line-number-anchored doc edits are conventional, not blocking.
- Prerequisite (`reviewActuator` implemented) need not echo in `index.md`.
