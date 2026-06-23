# Robustness/Prevention Batch — Final Report

_Session of 2026-06-19 → 2026-06-20. This report is gitignored (local artifact)._

The four seeds were **not planned up front** — every one of them surfaced _from running_ the A–J hardening bundle. Dogfousing the harness on itself exposed its own failure modes; this batch fixes them. All four are merged.

## What shipped

### #10 — Bound the completion fix-up loop on a non-converging _changing_ failure (#323)

The completion gate's fast-stop (`ready-stuck-red`, exit 10) only fired when the **normalized failure text was identical** across iterations. A failure that _changed_ each pass (churning unfixable lint, a flaky test failing on a different test) never tripped it and rode `maxIterations` — the 47-minute spins seen on C/B/J. Added `consecutiveRedFixups` + `acProgressSinceLastGate`: a completion that stays red across N=3 fix-up iterations with no AC progress now stops at the bound with a distinct message; resets on a green gate or real AC progress. The green-dirty commit and identical-failure stop (already shipped) are untouched. **The planning agent caught that the obvious fix was already shipped and refused a no-op spec — the refined intent targets the real residual gap.**

### #9 — Bounded tick-retry: spare a green iteration that edited files but ticked nothing (#328)

Every multi-subspec spec hit this: the agent finished a subspec's work green but ended its turn before ticking the boxes, so the harness exited 6 immediately → mandatory operator re-run, ~doubling each spec's agent cost. Now an edited-but-unticked iteration on a green tree gets a bounded retry (N=2) to tick before exit 6. Plus the **deadlock fix**: acceptance criteria ticked in the working tree but uncommitted are committed at iteration start and advance the spec (previously a re-run saw them "already ticked" and stopped again forever). Never auto-ticks — the agent still owns every tick.

### #11 — spec-guidance convention: refactor preservation ACs cite the test (#326)

The convention that behavior-preserving ACs should cite the pinning test (`"<test> stays green"`) instead of paraphrasing behavior — the failure that caused the D spec defect — now lives in `spec-guidance.md`, **explicitly scoped to refactor/preservation ACs only** (new-behavior ACs are exempt; the rule is never an all-ACs requirement). The runtime enforcement (plan-draft anchor warning) had already shipped via E (#305); this is the human-facing convention.

### #15 — Stabilize flaky process-timing tests (#329)

Load-sensitive tests that spawned real process trees and asserted on OS timing — flaky under load **and** unrunnable in the coding agent's sandbox (it can't spawn processes), which false-blocked F twice. Fixed via the "test the logic, not the integration" insight:

- **Reap DescendantTracker tests:** added a minimal dependency-injection seam (constructor `listProcesses`/`kill` providers, production unchanged) and rewrote the two flaky spawn-based tests to feed a **fixed in-memory process table + recording kill** — structurally deterministic, sandbox-safe, assertion intent preserved.
- **Watchdog grandchild test:** widened the timeout window (1500→4000ms) so the descendant is reliably alive at snapshot; its detection logic is now covered structurally by the injected-table tests. _(Full structural determinism of this real-process integration test would need invasive watchdog injection — deferred as low-value given the logic coverage. Spec ACs amended to match the actual approach.)_
- Also removed a dead `PreflightResult` type (latent lint debt the F extraction left on main).

## Honest notes / deviations

- **#10 and #15 changed approach mid-flight.** #10's first intent described already-shipped behavior (the plan blocked it); refined to the changing-failure gap. #15's merged spec said "poll-until, no impl change" but the better approach (DI + injected tables) needed a tiny reap.ts seam — sanctioned by the "other ways of testing" steer; ACs were amended rather than dishonestly ticked.
- **#9 and #15 were finished by hand.** The coding agent implemented #9's logic correctly but couldn't write the multi-turn fake-agent tests (its "looping isn't working" was test-harness confusion, not a logic bug — the happy-path test passed on the first try). #15 couldn't run in the agent's sandbox at all. Both were validated and finalized manually.
- **A latent lint issue reached main** via a manual admin-merge whose completion gate didn't run (the dead `PreflightResult`). Cleaned up in #15. Worth noting: hand-merges skip the gate that would have caught it — ironically the kind of thing #9/#10 exist to make reliable.

## Grounding-first paid off

Reading each seed against the actual code _before_ writing the intent stopped two no-op specs (#10 already-shipped parts; #15's wrong approach) and produced sharply-targeted intents — the same discipline whose _absence_ caused the original D defect this batch's #11 prevents.

## Cost & tokens

| | jarvis runs | cost | tokens in | tokens out |
| --- | --- | --- | --- | --- |
| **Robustness batch** (jarvis) | 22 | $12.01 | 41,673 | 107,279 |
| **Whole session** (jarvis, excl. groceries) | 128 | **$72.37** | 186,970 | 1,284,386 |

Whole-session cache: 126.3M read / 5.4M write; **133.2M total tokens**. The batch figure undercounts the hands-on portions (#9/#15 manual finishes, #11 hand-done) which aren't billed as jarvis runs — those are the Claude Code session itself.

## State at close

9 bundle specs + 4 robustness fixes merged; no open PRs. Two seeds remain **deliberately untouched**: `plan-git-false-boundary-misfire` (your unvalidated bug report) and the harness will keep both as wip-intents for a future session.
