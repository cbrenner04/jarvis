# Adjudicator verdict: `cleanup-without-listening-daemon`

Required refinements before the spec is implementation-ready:

## Intent ↔ subspec alignment

- **Keyed socket scope:** Align intent acceptance criteria with the subspec: behavior is defined for the **digest-keyed socket used by the invoking `jarvis`**, not “any key” or multi-socket discovery. Note in documentation tasks that broader discovery is out of scope here (sibling intent), without expanding this spec’s tests to discovery.

## Exit-status contract (must fix — core intent)

- **`hasNothingToClean` vs daemon skips:** The spec must require that **daemon-unreachable worktree skips are recorded during discovery** and **drive the command exit code even when** reaper/stranded phases are empty and eligible candidates are empty (today’s early return 0 path). Acceptance criteria and regression tests must pin this; update or supersede expectations in the existing “daemon client throws” / dry-run behavior so the spec cannot pass while still exiting 0 when merged worktrees were skipped only for daemon unreachability.

- **Counter scope:** State explicitly that **only** skips attributable to **daemon unreachability** (absent keyed listener or failed live probe) set non-zero exit; **other** `checkEligibility` ineligibility (PR not merged, active runs, etc.) **must not** change exit code from current behavior.

- **Lifecycle of the skip flag:** Non-zero exit when any daemon-unreachable skip was recorded must apply on **dry-run preview**, **operator cancel/decline**, and **apply**, not only when retire/remove paths return non-zero.

## `--abandon` (must fix — safety gap)

- **Product decision under no listener:** Beyond shared connect classification and an absent-daemon client, the spec must decide **abandon** when the daemon is absent or live checks fail: e.g. refuse with message and non-zero, proceed with existing fail-open live semantics, or another explicit rule. Document that choice in decisions, acceptance criteria (as behavior), and `v2/docs/operator-runbook.md`.

- **Absent-client shape:** Decisions must cover **`checkWorkflowStartClaim`** (and any other abandon-required probes) on the absent-daemon client so abandon does not always refuse with “missing workflow start claim probe” unless that is intentional.

## Operator-visible behavior

- **Preview vs internal “ineligible”:** Clarify whether operators must see skipped merged worktrees and a **named daemon-unreachable reason** during bulk preview (stdout/stderr). If yes, add an acceptance criterion; if no, tone down intent/subspec language that implies visible “marking.”

- **Recovery stderr:** Specify **when** the single recovery line is emitted (e.g. whenever continuing without a listener vs only when merged worktrees were considered).

- **Stable strings:** Require operator-facing unreachable text **without** bare keyed socket paths or raw `connect ENOENT` / leaked `err.message` in stderr or skip reasons.

## Tests and acceptance criteria (spec guidance)

- **Name the primary regression test** in the first behavioral AC (not “first regression test”).

- **Guard inversion:** Keep connect-continue inversion AC; add symmetric inversion for **`listRuns()` abort** if that guard is part of the deliverable.

- **Connect fail-closed branch:** Add an AC that **non–no-listener** connect failures (e.g. timeout, permission) still **abort before** reaper/stranded work.

- **Existing CLI test:** Address the test that expects connect failure → error + exit 1 via an explicit **replaced behavior** AC or a preservation citation, per refactor/new-behavior guidance.

- **CI/typecheck ACs:** Optional trim only; not required for verdict.

## Documentation tasks

- **Runbook:** Absent keyed socket vs connected-but-unreachable; phases that run without a listener; exit contract including **non-daemon** ineligibility and **interim** “live daemon on another digest may still yield exit 1 + skipped merges” until discovery sibling ships.

- **`v1-behaviors.md`:** Same no-listener continue, recovery hint, exit contract, and **abandon** under no listener per the product decision above.

## Subspec structure

- **No split required:** One subspec remains appropriate for a single operator-visible behavior if the refinements above are applied; the gap is **precision of ACs and abandon policy**, not missing decomposition. Do not split unless abandon policy is deferred to a **separate** spec with its own index entry—in that case this spec must **not** claim `--abandon` connect parity without defining downstream abandon behavior.

---

**Rationale:** Intent requires continuing daemon-independent work without silently succeeding when merge cleanup was withheld for daemon reachability. Current code can exit 0 when only daemon-unreachable merged worktrees exist and `hasNothingToClean` fires; abandon’s live-check and claim-probe paths diverge from bulk eligibility unless explicitly decided. Spec guidance requires failing tests, named guards, and clear behavioral ACs—ambiguous exit accounting and abandon policy would let an implementation satisfy letter of connect-continue while violating intent.