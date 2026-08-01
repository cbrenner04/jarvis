Reviewing the implementation seams the spec targets so the verdict matches the codebase.
## Verdict: required refinements

1. **Pin autofix placement and success-path contract.** The spec must state that autofix runs once per `publishWithReadyRepair` red-gate repair entry, after fence allowset freeze and **before** the repair `while` loop (not inside an iteration). It must also define the success path end-to-end: run autofix → validate staged candidates through the frozen allowset → commit in-scope changes → republish/re-gate, without emitting `ready_gate_repair` or consuming repair iterations. Commit attribution (message/trailer shape) must be decided so autofix commits are distinguishable from agent repair commits.

2. **Resolve `fixCommand` as a deliverable, not optional wording.** Intent and decisions require per-project `fixCommand` with v1 skip-when-absent semantics, but v2 ready-gate repair does not wire project config today. The spec must either (a) require extraction/plumbing from registered project config into the repair loop plus a regression that exercises a custom `fixCommand`, or (b) explicitly defer custom `fixCommand` to a follow-up intent and narrow intent/decisions to built-in `bun run fix` only. Leaving “reuse or extract” without choosing (a) or (b) over-promises relative to the incident fix.

3. **Define autofix failure and timeout behavior.** The spec is silent on non-zero exit, timeout, and worktree state after a failed fix. It must decide whether autofix failure terminates the run (v1-aligned fail-closed) or falls through to agent repair only when fix exits successfully but the gate stays red. Timeout must bind to existing gate timeout policy (`iterationTimeoutMs`). Without this, implementers can silently fall through with a corrupted worktree or charge agents for fix-command crashes.

4. **Cover gate-only resume — do not defer.** The motivating incident recovered via manual `bun run fix` + `jarvis run resume`. Gate-only resume enters `publishWithReadyRepair` with `maxIterations: 0`, which skips the agent repair loop entirely today. Placing autofix before the `while` loop is the intended fix, but the spec must **resolve** the current deferral: autofix must run on every repair entry including gate-only resume and review-mutation publication tails. Add an acceptance criterion (and named test) for exhausted-red resume with formatter-only dirt that autofixes and re-gates without manual fix or agent invocation.

5. **Tighten mixed-failure budget acceptance.** “Full `MAX_READY_GATE_REPAIRS` budget” is too loose. The mixed-failure AC must assert observable contracts: autofix invoked exactly once; exactly three `ready_gate_repair` events if all agent attempts stay red; zero repair-budget charge for autofix (`repairAttempt` / `iterationsConsumed` unchanged by autofix).

6. **Tighten formatter-only success acceptance.** Align with intent: assert successful publication (green re-gate, no `ready_gate_failed`), not merely terminal `complete`.

7. **Add agent-verifiable documentation acceptance criteria.** Four doc files are listed under Documentation updates but no ACs verify them. Per repo convention (sibling ready-gate repair specs), add worktree-verifiable ACs that each named doc reflects autofix-first ordering, repair-budget exclusion, and removal of obsolete operator guidance.

8. **Correct `v1-behaviors.md` framing.** The doc task must record **v2’s new** ready-gate-repair autofix behavior and its **analogy** to v1 completion-gate autofix (`runReadyAndCommit`), not imply v1 already autofixes on a bounded repair loop.

9. **Align “once per gate failure” terminology.** Intent and subspec use slightly different scopes. Unify on “once per `publishWithReadyRepair` repair entry” so mutation-repair republication tails and separate publication attempts are unambiguous.

10. **Expand runbook cleanup scope.** Documentation work must delete or update **all** stale manual-fix guidance: the 2026-07-30 stopgap (~1181), the pre-`red-gate-feeds-back-to-the-agent` bullet (~1449), and the main ready-gate repair prose (~502) for autofix-first ordering.

11. **Name duplicate `write-behavior.md` maintenance.** The doc task must require updating the canonical ready-gate repair fence paragraph and deduplicating the duplicated block (~429–430), so implementers do not edit the wrong copy.

12. **Add preservation acceptance criteria (low cost, recommended).** Because the change edits `runReadyGateRepairLoop` entry, cite existing pinning tests that must stay green — gate-timeout skip-repair behavior and the `ready-gate repair fence` describe block — per spec guidance for behavior-preserving loop edits.

**Rationale:** Items 1–5 close product and safety gaps directly tied to the incident (resume-shaped recovery, budget accounting, fence commit path). Items 6–11 satisfy spec guidance (failing-test ACs, agent-verifiable doc ACs, v1-behaviors parity catalog, no over-promised config). Item 12 is optional hygiene that reduces regression risk on a hot loop.

**Not required to block:** human-only guard-inversion ACs (repo convention), optional `ready_gate_autofix` telemetry, belt-and-suspenders markdown-only fence regression beyond `validateReadyGateRepairCompletion` reuse, re-adding Prerequisites to the subspec body.