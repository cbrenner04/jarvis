Reviewing implementation paths against the spec and advocate response to issue a verdict.
## Verdict: required outcomes

### 1. Decouple display-tick clock from unattributed terminal-window filtering

**What must be true:** Advancing the local display tick may update elapsed text, but it must not change which unattributed runs appear in the left-pane tree or leave `selectedNodeId` pointing at a node that is no longer in the painted/selectable tree until the next daemon refresh.

**Why:** Display tick calls `syncMonitor()` with fresh `nowMs`, which flows into `monitorLeftPaneTreeRows` → `buildMonitorPipelineTreeJoin` → `filterMonitorRunsForLiveWindow`. That re-evaluates unattributed terminal retention on every display tick, not only on refresh. Rows can disappear from the tree while selection still references them; selection is only reconciled in `refreshRuns`, not on display tick. Subspec 02 scoped the display tick to elapsed animation without extra RPC — not to shifting tree membership between refreshes.

---

### 2. One display-tick mechanism in production

**What must be true:** Production elapsed ticking is owned by a single, wired path. The unused `displayTickScheduler` parameter on `openInkMonitor` (never passed from `openMonitor()`) must be removed or consolidated so there is no parallel dead scheduler API.

**Why:** Elapsed animation in production runs `tui-entry` display tick → `syncMonitor()` → `session.update()` → ink rerender with fresh `clock()`. The ink-level scheduler is redundant dead surface that misleads future callers about where ticking lives.

---

### 3. Pin finishless-terminal elapsed ticking

**What must be true:** A regression test proves that a terminal run with no `finishedAtMs` keeps advancing elapsed as `nowMs` advances on the display/local clock, and does not freeze from status alone.

**Why:** Subspec 02 documents and accepts this rule in operator docs and AC (“freeze only when the recorded end timestamp is present”). Terminal-freeze pins cover the `finishedAtMs`/`endedAt` case; the inverse (terminal status, absent end timestamp, elapsed still ticks) is documented but untested. `finishlessRow` is pinned for retention only, not elapsed behavior.

---

### Not required

- **Collapsed-workflow elapsed pin:** Representative indirection is structurally correct via `monitorTreeRun`; docs AC is satisfied; pin is useful insurance but not a merge blocker.
- **Pipeline zero-duration elapsed (`finishedAtMs === createdAt`):** Pre-existing projection surfaced by elapsed; out of subspec 02 AC scope.
- **Day-tier width cap accuracy:** Spec-compliant tradeoff; pins assert ≤8 code units, not exact values at extreme durations.
- **`intent.md` checkbox drift:** Routing artifact hygiene; subspec ACs are complete and authoritative.
- **`parseListRuns` `createdAt` validation:** Pre-existing trusted-local-socket model; outside this slice.
- **Dual 1s timers:** Explicit subspec 02 decision to decouple display clock from RPC refresh.