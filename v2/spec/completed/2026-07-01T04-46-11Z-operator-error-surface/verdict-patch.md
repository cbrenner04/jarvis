## Verdict

Subspecs 00 and 01 are substantially complete: closed `{ reason, retryable, nextAction }` contract, shared composer, wire strictness, CLI pass-through, and documented omission rules. Two operator-contract gaps remain on realistic resume/spawn-failure paths; a third is documentation/behavior alignment on status demotion.

### Required outcomes

1. **Chronological terminal selection on multi-event runs**  
   When a run’s log contains both `loop_finished` and `run_execution_failed`, `list` and `wait` must compose `error` from the terminal event that actually ended the current quiescent state—not from any earlier `loop_finished` merely because that kind ranks higher. In particular, a later `run_execution_failed` on a reused `runId` (e.g. spawn failure after resume) must be able to produce `harness_failure` on quiescent `list`/`wait`, matching what a live `wait` subscribed after that event would see. `list` and `wait` must continue to share one selection rule. Add unit coverage for coexistence (prior `loop_finished` + later `run_execution_failed`).

2. **Tie-break: durable `failed` / `blocked` over resumable log outcomes**  
   When durable `runStatus` is `failed` or `blocked` and there is no mappable last-attempt detail, resumable `loopOutcomeKind` values (`paused`, `budget-exhausted`, etc.) must not win—operators must not see `resumable_*` reasons while status is `failed`. Extend tie-break accordingly and add unit coverage (e.g. `failed` + `loop_finished` `paused`/`budget-exhausted`, no attempt detail → non-resumable stop, typically `harness_failure` or another non-resumable mapped reason per existing tables).

3. **`budget-soft-stopped` → `failed` demotion semantics**  
   Spawn-boundary failure can demote `budget-soft-stopped` to `failed` because it is omitted from terminal-status guards. Define and document how `error` should read after that transition (and whether demotion itself should change). Outcome must be consistent across `list`/`wait` and must not regress to `resumable_budget` from stale budget logs while status is `failed`. Update `daemon-host.md` composition/tie-break section to match.

4. **Doc alignment after precedence/tie-break fixes**  
   `daemon-host.md` currently states `loop_finished` is preferred over `run_execution_failed` without recency. Revise to describe the settled selection and tie-break rules operators and script authors rely on, including spawn-failure-after-resume and demotion cases.

5. **Targeted integration hardening (minimum)**  
   Beyond existing unit ACs: one socket-level assertion that `wait` carries `error` for a log-backed non-resumable stop (e.g. `blocked`); optional doc-comment on exported `TerminalLogRecord`.

### Rationale

Intent requires actionable error detail without log inspection and without re-parsing status strings. Gaps (1) and (2) break that on resume and spawn-failure paths: quiescent surfaces can disagree with live `wait`, misclassify harness failures as resumable stops, or surface `resumable_budget`/`resumable_pause` while `runStatus` is `failed`. That violates subspec 00’s list/wait parity, harness producer rows, and resumable-status-wins tie-break scope. Gap (3) is a pre-existing daemon behavior that this slice owns at the `error` boundary. Gaps (4)–(5) keep the wire contract truthful and guarded as behavior changes.

### Not required for merge

- CLI reclassification or exit-code coupling (correctly decoupled per subspec 01).
- Immediate `shared/` relocation (no v1 consumer).
- Deduplicating wire validation unions (maintainability only).
- `run_execution_failed` → immediate `harness_failure` when that record is the selected terminal (spec-aligned once selection is fixed).
