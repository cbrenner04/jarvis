## Verdict — required refinements

1. **Fix-up iteration boundary** — Pin that patch-implementation idle-timeout escalation is suppressed on fix-up iterations (terminal exit `8`, same as no-progress). The idle handler currently has no `isFixupIteration` guard; “mirrors no-progress ladder mechanics” is insufficient without this explicit rule.

2. **`captureInterruptedDelta` on escalation** — Pin that idle-timeout escalation does **not** call `captureInterruptedDelta` (run continues; matches no-progress escalation). Terminal idle abort keeps the existing call.

3. **New-behavior acceptance criteria must bind tests** — The two escalation scenarios (multi-agent continue vs final-rung exit `8`) live only in the task checklist. Add acceptance criteria that name the target test file(s) and approximate test titles so the new behavior cannot be ticked without automated coverage. Preservation ACs already cite pinning tests correctly.

4. **Task checklist test locations** — Replace vague “sandbox/integration test” wording with concrete paths (`run.test.ts`, `run.sandbox-unrunnable.test.ts`, or both) and approximate titles, consistent with preservation AC style.

5. **`v1/docs/workflows.md`** — Add to documentation updates. The implementation-loop diagram still routes no-progress straight to exit `4` and all timeouts to exit `8`; idle cascade widens existing drift. Update idle escalate-then-terminal edges and no-progress ladder edges in the same pass.

6. **`v1/docs/run-loop.md` exit table** — Documentation updates must cover the exit `8` table row (~991), not only the idle-watchdog section (~1069). Both currently describe idle abort as unconditionally terminal; they must reflect patch-implementation escalate-then-terminal semantics and distinguish iteration/run wall-clock timeouts (still terminal, no cascade).

7. **`v2/docs/outcome-data-source-audit.md`** — Add `watchdog-idle-timeout-fallback` to the telemetry inventory as a non-terminal per-rung row (same class as `no-progress-fallback`). Note that escalation rows use `kind: "timeout"` while terminal idle uses `watchdog-idle-timeout`; document that final identity-bound row drives run-level outcome hints.

8. **`quota-signals.md` kind semantics** — Extend the planned telemetry table update to state that `watchdog-idle-timeout-fallback` is non-terminal despite `kind: "timeout"` (distinct from terminal `watchdog-idle-timeout`).

9. **`operator-runbook.md` task** — Reframe from “remove or narrow manual switch-models workaround” to **add** a short note that patch-implementation idle stalls auto-escalate when fallback rungs remain. No removal acceptance criterion; current runbook has no dedicated silent-stall manual-switch guidance to delete.

10. **Escalation telemetry field completeness** — Pin that escalation rows carry the same meta/diagnostic field set as terminal idle rows (including `configured_model` via `telemetryMeta` spread or equivalent), not only the explicitly listed stall fields.

## Optional refinements (not merge-blocking)

- **`maxIterations` interaction** — One decision line or preservation AC citing `run.test.ts` `maxIterations pre-empts no-progress ladder exhaustion` if operator surprise is a concern; inherited from no-progress parity otherwise.
- **Tier suffix** — One FakeAgent tier test mirroring no-progress, or an explicit “inherits `activeAgents` init suffix” decision.
- **Fast FakeAgent idle-escalation test** — Improves reviewability; sandbox coverage is sufficient for this subspec.

## Upheld without spec change

- Core behavior (patch-implementation-only, mirror no-progress `shift()` + iteration increment, terminal exit `8` on final rung, distinct stderr constant, `exitReason` split, run-wide ladder consumption, reaping reuse).
- Telemetry `kind: "timeout"` on escalation (intentional given watchdog kill path; `exitReason` split is the contract).
- Intent vs spec `watchdog-idle-timeout` / `watchdog-idle-timeout-fallback` naming (matches `no-progress` / `no-progress-fallback`).
- Review/shrink/plan prompt-phase exclusions; prerequisites omission in subspec.
