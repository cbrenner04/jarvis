## Verdict

**Direction upheld:** Two-subspec split (daemon wire composer → thin CLI), closed `{ reason, retryable, nextAction }` contract, shared list/wait composer, no stderr/transcripts, doc homes in `daemon-host.md` / `write-behavior.md` / `v1-behaviors.md`. Gaps are mapping completeness and operator-contract edge cases, not scope or architecture.

### Required refinements

**Subspec 00 — composer mapping**

1. **Kill coverage must include the production abort path.** Durable `killed` runs commonly also have a terminal `loop_finished` with `loopOutcomeKind: "progress"` (`write-loop.ts` abort path). The mapping and ACs must treat `resumable_kill` for both log-absent and log-present kill shapes — not only `(no loop_finished)`.

2. **Store-only fallback must be fully specified.** The decision names log → store-only precedence but the table is almost entirely log-keyed and no AC exercises store-only. Add rows mirroring `committedResult` / last-attempt `outcome_kind` for at least: `paused`, `budget-soft-stopped`, `blocked` / `contract_miss`, `failed` with binding-chain `invocation_failure_detail`, `invalid_token`, and legacy detail-free `invocation_failure`. Unit AC per path.

3. **`harness_failure` must not capture store-only invocation failures.** Gate `harness_failure` on absence of mappable invocation detail in durable store (spawn-boundary `run_execution_failed`, or `failed` without log and without mappable attempt detail). Unit AC: `failed` + store invocation detail, no terminal log → invocation `reason`, not `harness_failure`.

4. **Pin `invocation_failure` disambiguation.** When terminal signal or store implies `invocation_failure`, branch on attempt `outcome_kind` first (`invalid_token` vs binding-chain `invocation_failure`), then `invocation_failure_detail.failureKind` — not `loopOutcomeKind` alone.

5. **Legacy detail-free binding-chain `invocation_failure`.** Per `state-store.md`, null-detail rows exist. Map to `invocation_error` / `stop` (conservative), not `harness_failure` or unmapped. Unit AC.

6. **Conflicting terminal log vs durable status.** Define tie-break: durable `runStatus` wins for resumable terminals (`killed`, `paused`, `budget-soft-stopped`); for `failed` / `blocked`, attempt store detail breaks ties when log and status disagree. Unit AC for known `runStatus: "failed"` + `loopOutcomeKind: "complete"` shape (`cli.test.ts` exit-code matrix).

7. **`list` without `logReader`.** Specify production always injects `logReader`; when absent (tests), compose store-only only — do not fail `list` or omit all `error`. Document in `daemon-host.md`.

8. **Malformed `error` on wire.** Invalid `reason` / `nextAction` / `retryable` rejects the entire `list` / `wait` payload (match existing `daemon-wire` strictness). Parser AC.

9. **Remove `nextAction: "none"`** from the closed union unless a concrete producer row exists. No row emits it today.

**Subspec 00 — documentation ACs**

10. **`error.retryable` vs `wait.resumable`.** Document intentional split: `error.retryable` is the operator-action signal; `wait.resumable` remains loop-log legacy and may be absent on store-only quiescent resolves (e.g. killed without loop fields). `daemon-host.md` AC.

**Subspec 01 — CLI operator contract**

11. **Breaking list column width.** Doc AC must state eight-column layout, `-` placeholder semantics, and that positional five-column parsers break — `write-behavior.md`; optional `[v2 additive]` migration note in `v1-behaviors.md`.

12. **Exit codes decoupled from `error`.** Doc AC: `wait` exit codes follow the existing `loopOutcomeKind` / `runStatus` matrix; `error` is informational stdout only (e.g. `retryable: true` with exit `4` on killed). `write-behavior.md`.

13. **TUI deliberate gap.** One doc line: TUI unchanged; thin CLI gains `error` — operators using both see different field names until a future TUI slice. `write-behavior.md` or `v1-behaviors.md`.

**Optional (low load)**

14. **Module placement.** If v1 may consume types later, pin `shared/` in task checklist; else `v2/src/` with named export. Omit if implementer default is obvious.

### Rationale

Intent requires actionable error detail without log inspection and without re-parsing status strings. Incomplete mapping (kill-with-log, store-only, legacy rows, conflicting signals) would ship `undefined` or wrong `reason` on real production paths — defeating the intent. Doc gaps on `retryable` vs `resumable`, exit-code split, and column migration would confuse operators and script authors at the first consumer.
