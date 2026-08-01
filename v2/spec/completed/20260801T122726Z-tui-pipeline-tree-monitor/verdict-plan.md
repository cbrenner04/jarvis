# Verdict: TUI pipeline tree monitor spec

Required refinements before implementation. Ordered by severity.

---

## Blockers (must fix)

### 1. Stage expansion must materialize workflow constituent runs

Intent and subspec 02 require that pressing `e` on a stage shows constituent workflow runs and replaces `expandedWorkflowInvocationIds`. The merged tree model currently collapses stage runs at build time; flatten only reveals collapsed leaves—it does not produce `workflow-child` rows.

The spec must close this contract gap with an explicit task and a failing acceptance criterion: collapsed stage → one run row; expanded stage → parent + child workflow rows in pane order. State whether the tree builder accepts expansion input at flatten/join time or a prerequisite patch lands first. Subspec 02 cannot claim the pure tree module is “unchanged” if monitor wiring requires tree-model changes.

**Why:** Without this, the primary `e` behavior in intent cannot ship; subspec 02’s stage expansion AC would pass on the wrong semantics.

### 2. Subspec 00 must not claim ink wiring it does not verify

The first subspec’s acceptance criterion says tests fail when the ink shell still uses flat `monitorLeftPaneTableRows`, but named tests only exercise pure derivation. Either add a verifiable outcome that the ink left pane consumes the tree derivation (entry or ink integration, via state/hooks—not painted ink), or reword the criterion to match what derivation tests actually prove.

**Why:** Spec guidance requires failing-test ACs that motivate real behavior; a mismatched failure claim lets implementers satisfy ACs without shipping the visible left pane.

### 3. Subspec 00→01 coupling must be explicit

After subspec 00 alone, the left pane shows a tree but `j`/`k`/arrows still walk flat run order until subspec 01. The spec must either: (a) state that 00 is not operator-complete and must not land without 01, (b) fold minimal selectable-list alignment into 00, or (c) accept and document the brief broken navigation window as an implementation-branch-only artifact.

**Why:** Intent is one observable behavior; a shippable intermediate state contradicts operator expectations and spec guidance on atomic subspecs if 00 is treated as independently complete.

### 4. Subspec 01 must cite the correct navigation test

The acceptance criterion naming `drives row navigation through the injected input hook` points at an ink stub test that only verifies control stubs fire—not tree + unattributed pane order. Retarget to the entry-level navigation test (updated for tree order), and keep the ink test as a preservation citation if needed.

**Why:** Wrong test anchors produce false completion signals per spec guidance’s refactor/preservation AC rules.

---

## Should fix (material quality gaps)

### 5. Multi-level depth indentation needs a verifiable outcome

Tasks reference depth from `node.depth`, but existing row helpers do not accept depth. Add an acceptance criterion pinning multi-level indent (e.g. workflow-child at depth 3 under a stage) in left-pane derivation output.

### 6. Pipeline-level `e` needs its own acceptance criterion

Subspec 02 decisions cover pipeline and stage; the primary expansion AC exercises only a stage. Add a criterion: `e` on a selected pipeline toggles stage/run visibility; second press collapses.

### 7. Subspec 01 decisions need failing ACs for high-risk behavior

Add 2–3 acceptance criteria covering:
- Stale `selectedNodeId` cleared when the node disappears from the selectable list after refresh
- Run steering (kill/pause) no-op when pipeline or stage is selected
- Initial selection after refresh is the first selectable tree or unattributed row in pane order

Optional but valuable: wait/outcome panel cleared or hidden on pipeline/stage selection.

### 8. Right-pane and programmatic selection resolution must be specified

Subspec 01 must state that pipeline/stage/run lookup for the right pane uses the same tree derivation as the left pane (no parallel snapshot walk). Clarify migration of `selectRun`—rename to node selection or restrict to run leaves—with an AC that programmatic selection of a pipeline or stage id updates `selectedNodeId`.

### 9. `maxVisibleRows` and queue reservation must be unambiguous

Pin in subspec 00 decisions:
- Whether `maxVisibleRows` subtracts queue heading only or heading plus queue row count
- Whether unattributed rows count against pipeline FIFO viewport budget (intent implies they do not)
- Pass `nowMs` into left-pane tree derivation (from entry deps; fixed clock in tests)

### 10. Dead `expandedWorkflowInvocationIds` during 00–01

Acknowledge in subspec 00 or 01 that `e` on unattributed rows mutates invocation expansion with no visible effect until subspec 02 removes it—or move removal earlier if that window is unacceptable.

### 11. Documentation scope in subspec 02

Broaden doc tasks beyond a single “observation row” to reconcile `jarvis tui` sections in `operator-runbook.md` and `v1-behaviors.md` for: pipeline-attributed run window exemption, pipeline/stage `e`, three-deep selection, and retired flat workflow `e` expansion.

### 12. Wording fix

Replace subspec 00’s “slice 2” reference with “subspec 02” or “expansion subspec” to avoid confusion with subspec 01.

---

## No refinement required

- Cross-daemon snapshot concatenation without dedup (explicit decision, single-operator scope)
- Prerequisite relative links (plan-staging artifact; correct after merge to `v2/spec/`)
- Deferral of unattributed segment headers/FIFO polish to a future slice (named in intent)
- Re-proving pure tree collapse, reveal-on-select, and FIFO in integration ACs (covered by merged tree-model tests plus wiring ACs above)
- In-app help string for non-ink callers (low operator impact; optional cleanup only)

---

## Summary

The three-subspec split and prerequisite chain are sound. Implementation is blocked primarily by the stage-expansion / workflow-constituent contract conflict with the current tree model (#1). Secondary blockers are test/AC fidelity (#2, #4) and the 00→01 operator-incomplete window (#3). Remaining items tighten verifiability and align prose with intent without changing scope.