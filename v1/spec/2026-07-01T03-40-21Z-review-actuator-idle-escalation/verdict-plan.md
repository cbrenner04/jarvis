## Verdict — required refinements

### 1. Reconcile intent exit class with committed review semantics
`intent.md` still pins final-rung terminal process exit `8`; the spec correctly pins exit `11` with telemetry `exitReason: "watchdog-idle-timeout"`. Align intent (or an explicit spec note that intent is stale) so merge does not ship contradictory operator guidance.

### 2. Bound the problem to idle-fire stalls, not every 30-minute soak
Committed docs and code treat review idle as terminal today; patch implementation already escalates on idle-fire. File-activity liveness can defer idle-fire while `iterationTimeoutMs` runs, and that wall-clock path is explicitly out of scope. Problem prose and operator-runbook doc ACs must not imply this slice fixes iteration-wall soaks—only `aborted: idle-timeout` stalls with a later `reviewActuator` rung.

### 3. Gate listed documentation updates with acceptance criteria
Five docs are listed under `## Documentation updates` but none are gated. Per repo precedent (`2026-06-30T20-15-58Z-intent-agent-order-override-flag`), add doc tasks and ACs that obligate:
- `agents.md` / `quota-signals.md` / `run-loop.md`: review actuator idle escalation (ladder source, `review:` stderr prefix, fallback vs terminal telemetry).
- `run-loop.md` / `quota-signals.md`: reconcile the contradiction at `run-loop.md` ~1088 and `quota-signals.md` ~176 — review terminal idle is process exit `11`, not `8`; telemetry `exitReason` stays `watchdog-idle-timeout`.
- `operator-runbook.md`: review actuator idle auto-escalates through configured rungs; drop “wait out the 30-min wall” guidance for idle stalls.
- `v2/docs/v1-behaviors.md`: review-actuator idle escalation + final-rung terminal stop; shrink / review-panel / plan unchanged; note quota head-only vs idle full-ladder asymmetry for `reviewActuator`.

### 4. Add positive success-path acceptance criterion
Current AC only negates exit `11` on non-final stall. Require observable success: after escalation, a completing later rung finishes verdict application and the review phase returns `0` (or otherwise continues past the actuator), not merely “does not exit `11` from the first stall.”

### 5. Pin non-terminal fallback must not arm terminal idle exit
Decision and tasks imply continuing the actuator loop, but committed code sets `idleTimeoutOccurred` on any idle abort (~1144). Add an AC: non-terminal `watchdog-idle-timeout-fallback` does **not** set `idleTimeoutOccurred` and does **not** surface `ReviewTerminalError` for idle; only final-rung idle arms exit `11`.

### 6. Add `iterationTimeoutMs` terminal preservation AC
Load-bearing decision (“no cascade on iteration timeout”) lacks verification. Add a preservation AC mirroring patch implementation—e.g. idle fires before iteration wall on review actuator, or iteration timeout stays terminal with no ladder advance—so implementers cannot accidentally cascade on wall-clock abort.

### 7. Pin `--agent` / pre-override ladder behavior
Decision uses pre-override `resolveSubRoleAgentOrder` config snapshot (consistent with `run.test.ts` `"review and shrink use pre-override patch order without subRoleAgentOrder"`). Add an explicit AC or preservation citation: review actuator idle escalation uses pre-override `reviewActuator` ladder, not `--agent` implementation override.

### 8. Tighten preservation ACs to cite pinning tests
Per spec-guidance (refactor/preservation ACs cite tests, don’t paraphrase):
- Replace umbrella “patch-implementation idle escalation tests stay green” with pinned titles from `run.sandbox-unrunnable.test.ts` (at minimum: escalates through `agentOrder`, final rung exits `8`, idle abort not classified as quota).
- Add preservation for existing single-rung `"idle watchdog timeout fires in review actuator phase"` (terminal `11` unchanged).
- Add preservation for `"idle watchdog disabled when idleOutputTimeoutMs is 0"` on review actuator (no escalation when disabled).

### 9. Pin multi-rung test injection for `actuatorAgents`
Today actuator binding uses `actuatorAgents?.[0]` only. Multi-rung escalation tests need a stated rule: how test-injected agents align with ladder shifts (e.g. parallel array indexed by rung, or head-only with config-only ladder). Without this, new tests may encode the wrong contract.

### 10. Optional hygiene (non-blocking if omitted, low cost if included)
- Task to fix stale “maps to exit 8” comment in the idle block while touching `review.ts`.
- Clarify in decisions or doc AC that each re-spawn gets a fresh idle watchdog and `iterationTimeoutMs` budget (inherits patch `continue` semantics; not load-bearing unless reviewers demand zero ambiguity).

---

**Rationale summary:** Core behavior and decisions are sound; gaps are verifiability (ungated docs, weak preservation anchors), a critical `idleTimeoutOccurred` contract the current code violates, success-path observability, scope honesty about iteration-wall vs idle-fire, and intent/spec exit-class drift. No behavioral reversal warranted—refinement tightens ACs and operator-doc alignment so implementation cannot ship a false `11` on fallback or undocumented doc contradictions.
