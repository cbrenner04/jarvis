Verifying implementation against subspecs 03 and 05 and checking open gaps before issuing the verdict.
# Verdict: subspecs 03 & 05

**Status: accept core contracts; required follow-ups before treating the slice merge-ready.**

Subspecs **03** and **05** satisfy their stated acceptance criteria: unchanged-path `ready_gate_out_of_scope` is terminal (`resumable: false`, `nextAction: stop`, resume admission rejected on write and review rows); autofix is typecheck-verified before fence commit with revert, `ready_gate_autofix_discarded` logging, and attributable allowset threading. Subspec **02** remains correctly unchecked on `index.md`.

---

## Required outcomes

1. **Reconcile changed-path resumability with subspec 03 scope.** This diff updates `daemon-host.md` to document resumable `ready_gate_out_of_scope` when outside paths change, and `outOfScopeSettlementResumable` implements that branch — but subspec **03** owns only unchanged-path settlement and no test exercises changed-path re-emission or resume admission. Either add regression coverage for changed-path settlement and resumable admission, or remove/narrow the daemon-host row and code path until a spec owns changed-path behavior. Undocumented or untested resumability is an operator-contract risk.

2. **Autofix fence refusal messaging must match attributable allowset enforcement.** Autofix now validates against `resolveAttributableRepairAllowset` but still uses the default diff/spec refusal prefix. When the attributable set is narrower than the frozen allowset (e.g. `lint:md`-only failures), operators can see misleading refusal text. Autofix and agent repair must surface the same attributable refusal wording whenever the attributable allowset is active — required by subspec **05**’s “completes autofix fence validation against the classification-derived attributable allowset” and subspec **02**’s refusal contract.

3. **Align `write-behavior.md` with landed autofix behavior.** Line 102 still describes fix → fence → commit without post-autofix typecheck, revert, or `ready_gate_autofix_discarded`. Line 104 partially contradicts implementation (attributable allowset on autofix vs frozen-only wording). Update the durable repair-semantics home to match what **05** shipped; operator-runbook alone is insufficient when behavior changed on the shared repair pipeline.

4. **Complete subspec 02 as the next index-routed slice; do not treat it as done.** `02-attributable-write-fence.md` ACs are prematurely checked while `index.md` leaves **02** open. The regression `repair refuses a staged path outside the attributable allowset` lacks a harness-linked `// @mutate` directive (only prose). Before ticking **02** on the index: add the linked mutation checkpoint, land **02** doc tasks (`write-behavior.md`, `v1-behaviors.md`), and revert spec AC checkboxes until the directive and docs land.

5. **Harden `outOfScopeSettlementResumable` with unit tests and empty-path behavior.** Add `ready-finalize.test.ts` coverage for first settlement, unchanged paths, changed paths, and no-prior-record cases. The `undefined`/`[]` paths branch currently returns `resumable: true`, which contradicts terminal unchanged-path semantics if malformed evidence ever reaches settlement; fail closed or test-exclude that path explicitly.

6. **If changed-path resumability is kept (outcome 1), make operator recovery text resumability-aware.** `RUN_OPERATOR_ERROR_RECOVERY.ready_gate_out_of_scope` is static terminal prose while `composeRunOperatorError` branches on `event.resumable`. Recovery guidance must not tell operators to stop when `resumable: true` remains possible.

---

## Rationale

Outcomes **1** and **6** close a gap introduced in this diff: operator docs and code advertise changed-path resumability outside subspec **03**’s bounded contract, without verification. Outcome **2** fixes a real inconsistency from unifying autofix fence allowset in **05** without matching refusal semantics. Outcome **3** satisfies documentation-standard alignment for behavior that changed on the shared repair seam. Outcomes **4**–**5** address spec integrity and regression pinning for the still-open **02** slice and the new resumability helper.

No further action required on **03**/**05** core behavioral ACs beyond outcomes **1**–**3** and **6** where they touch this diff’s surfaces. Subprocess/revert hardening and `log-stream` round-trip tests are optional improvements, not blockers.