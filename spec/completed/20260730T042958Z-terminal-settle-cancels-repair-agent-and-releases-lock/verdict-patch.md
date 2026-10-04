Reviewing implementation against the spec and advocate findings to issue a self-contained verdict.
## Verdict — required outcomes

1. **Daemon `killed` must not admit same-key workflows before `killed` is durable.** Workflow `finally` currently releases the registry claim before `commitGuardedKill`. Admission keys off the registry, so after repair quiesces a same-key implement start can succeed while the prior row is still non-terminal. Subspec 01 and `daemon-host.md` require that `killed` observation and same-key admission share the settlement boundary with ownership release. **Outcome:** no re-admission window between ownership release and durable `killed`; terminal `killed` must be observable before (or at the same boundary as) registry release and same-key admission.

2. **Add invert seams that satisfy the ticked mutation-pin acceptance criteria.** Subspecs 00 and 01 require inverting abort/join/terminal ordering, physical-lock release, registry-claim release, and kill ordering to turn the corresponding regressions RED. New tests only have comments (`Moving guarded kill ahead…`, `Inverting either owning release…`); existing invert hooks cover ordinary iteration races, not repair settlement. **Outcome:** each listed guard has an invert seam (or equivalent) that demonstrably fails its regression when inverted — matching the checked ACs.

3. **Pre-quiescence ownership retention must cover `completed` and `failed`, not only `killed`.** Subspec 01 AC claims independent proof that lock and registry stay held until repair quiesces and that a second writer is not admitted earlier. The parametrized re-admission test only holds repair open for `killed`; `completed`/`failed` vacuously pass timing clauses. **Outcome:** each terminal path (`completed`, `failed`, `killed`) holds repair open and asserts lock/claim retention (and refusal of a second writer) before quiescence, or the AC must be narrowed — the checked AC currently overstates coverage.

4. **Align `boundaryStamp.runStatus` with durable visibility during publication/repair.** `commitCompletionBoundary` now keeps the store `in-progress` during publication/repair, but `boundaryStamp` still carries `terminal.runStatus` (e.g. `completed`). In-process consumers can see `completed` in the return value while the store row is `in-progress` with live repair — the original failure mode at the API boundary. **Outcome:** stamp reflects durable terminal visibility (or is explicitly documented as iteration outcome, not terminal observation) and does not contradict the store during the publication tail.

5. **Correct `write-behavior.md` mutation-repair scope.** The doc states “Fresh and resumed publication and mutation-repair paths” keep the row `in-progress` during repair. Fresh implement does not generally enter mutation-repair settlement on first completion; that path is primarily resumed/review-mutation recovery. **Outcome:** doc wording matches actual settlement paths without implying every fresh implement hits mutation-repair settlement.

6. **Document or scope the global `idleOutputMs` join change in `shared/invocation/agents.ts`.** Idle-output expiry now waits for process close before settling `stall`, applying to all `idleOutputMs` invocations—not only finalization repair. A child that ignores `SIGTERM` can hang indefinitely instead of fast-settling `stall`. **Outcome:** if retained, document the global behavior change; if ordinary stalls should keep fast-settle, scope the join-wait to finalization-repair paths only.

---

**Not required in this patch** (scope or conventions):

- Bare `start { input }` write-loop kill deferral — subspecs target implement-workflow settlement paths.
- Socket IPC vs in-process handlers — matches established harness practice; `test:integration:v2` passes.
- Kill on `resume`-spawned finalization-only rows — outside implement-workflow kill-during-repair scope.
- `intent.md` open checkboxes — harness process artifact; subspecs are the landed work units.