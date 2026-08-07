# Verdict: Required refinements

## 1. Pin monitor lifecycle in Decisions

The spec must state that eligible typed `log` tears down the monitor session (same teardown `runTuiEntry` performs for production ink) and enters in-process log follow via `runTuiLogFollow`; the operator does not return to the monitor after follow — quitting follow exits `jarvis tui`, matching `jarvis tui log <run-id>`. Without this, implementers may treat `log` as a transient overlay or embedded pane, contradicting the intent’s “reuse the existing follow entry” decision.

## 2. Pin ineligible feedback codes; remove deferral

Replace “Deferred to first consumer” and open-ended “named feedback” with explicit `lastCommandResult` codes:

- **No run selected** (`selectedRunIdFromState` null with no run context): pin `no_selection`, consistent with existing dock verbs (`expand`/`collapse`/`start`).
- **Pipeline/stage selection** (`selectedNodeId` set but `selectedRunIdFromState` null): pin a dedicated code at plan time (not left to implement-time choice).

The ineligible-selection acceptance criterion and Decisions must name these codes so two implementations cannot both pass with different operator-facing strings. Spec guidance treats unpinned operator-facing codes as unfalsifiable premises.

## 3. Add a parser failing-test acceptance criterion

Acceptance criteria must include a named `tui-command-parser.test.ts` regression that fails against pre-fix code and passes after the change, asserting:

- bare `log` parses to `{ kind: "log" }` (no longer `recognized_unavailable`);
- trailing tokens (e.g. `log <run-id>`) yield `unexpected_arguments`.

Current AC #2 covers runbook/parser removal from `UNAVAILABLE_COMMANDS` but does not satisfy spec guidance’s requirement for a pre-fix-failing test on runtime parser behavior. Mirror the pattern used in sibling dock steering specs.

## 4. Split bundled happy-path / no-selection acceptance criteria

AC #1 currently merges “opens log follow for selected run” and “no run selected reports feedback” into one test title. The spec’s Work already lists separate tests; acceptance criteria must align:

- One criterion for happy-path dispatch through injected `runTuiLogFollow` with selected run id and the same tail deps as `jarvis tui log <run-id>`, failing against pre-fix code.
- A separate criterion for no-selection ineligibility asserting `no_selection` (or the pinned code) and no call to `runTuiLogFollow`.

Pipeline/stage ineligibility remains on its own test with the pinned code from refinement #2.

## 5. Clarify eligibility wording in acceptance criteria

Where AC #1 says “selected run leaf,” align with Decisions: eligibility is `selectedRunIdFromState` non-null, covering both attributed run leaves and unattributed runs in `state.runs`. Wording-only; no new test required if happy-path fixture selects from `state.runs`.

---

**Not required before merge** (architectural choices are sound): owner/actionable-run gating (follow entry owns cross-socket discovery), `lastCommandResult` vs `steeringFeedback` channel split, admission-pending blocking inherited from `submitCommand`, spy-based dispatch testing per TUI test strategy, subspec atomicity, prerequisite compression via `tui-dock-run-steering` ordering. Optional: a second mutation checkpoint for no-selection if eligibility branches split later; a Work note that production wiring extends `RunTuiEntryDeps` the same way CLI `entryDeps` already pass `runTuiLogFollow`.